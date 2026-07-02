import Anthropic from "@anthropic-ai/sdk";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import type {
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  ResolvedAgentModelConfig,
} from "./types";

interface AnthropicLikeResponse {
  content?: unknown;
  output_text?: unknown;
  message?: { content?: unknown };
  choices?: Array<{ message?: { content?: unknown } }>;
  _request_id?: string | null;
  stop_reason?: string | null;
}

function textFromValue(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (typeof block === "string") return block.trim() ? [block] : [];
    if (!block || typeof block !== "object") return [];
    const candidate = block as { type?: unknown; text?: unknown; content?: unknown };
    if (candidate.type && candidate.type !== "text" && candidate.type !== "output_text") return [];
    if (typeof candidate.text === "string") return candidate.text.trim() ? [candidate.text] : [];
    return textFromValue(candidate.content);
  });
}

function extractResponseText(response: AnthropicLikeResponse): string {
  return [
    ...textFromValue(response.content),
    ...textFromValue(response.output_text),
    ...textFromValue(response.message?.content),
    ...textFromValue(response.choices?.[0]?.message?.content),
  ].join("\n").trim();
}

function hasThinkingContent(response: AnthropicLikeResponse): boolean {
  return Array.isArray(response.content) && response.content.some((block) => {
    if (!block || typeof block !== "object") return false;
    const type = (block as { type?: unknown }).type;
    return type === "thinking" || type === "reasoning";
  });
}

export async function generateWithAnthropic(
  config: ResolvedAgentModelConfig,
  request: AgentModelRequest,
): Promise<AgentModelResponse> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    // Runtime-level retries have conversation context; SDK retries only repeat
    // the same long-running request and can multiply the configured timeout.
    maxRetries: 0,
  });

  try {
    let maxTokens = config.maxOutputTokens;
    let response = await client.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.prompt }],
    });
    let text = extractResponseText(response);

    const exhaustedDuringThinking = !text &&
      (response.stop_reason === "max_tokens" || hasThinkingContent(response));
    if (exhaustedDuringThinking && maxTokens < 8_192) {
      maxTokens = Math.min(maxTokens * 2, 8_192);
      response = await client.messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.prompt }],
      });
      text = extractResponseText(response);
    }

    if (!text) {
      const contentTypes = Array.isArray(response.content)
        ? response.content.map((block) =>
          block && typeof block === "object" ? String((block as { type?: unknown }).type ?? "unknown") : typeof block,
        ).join(", ")
        : typeof response.content;
      throw new AgentGatewayError(
        `Anthropic returned no usable text (stop_reason=${response.stop_reason ?? "unknown"}, content=${contentTypes}).`,
        "empty-response",
        "anthropic",
      );
    }
    return {
      provider: "anthropic",
      model: config.model,
      text,
      requestId: response._request_id ?? undefined,
      stopReason: response.stop_reason ?? undefined,
    };
  } catch (error) {
    throw normalizeProviderError("anthropic", error);
  }
}

/**
 * 流式生成文本（Anthropic Messages API）
 */
export async function* generateStreamWithAnthropic(
  config: ResolvedAgentModelConfig,
  request: AgentModelRequest,
): AsyncGenerator<AgentModelStreamChunk> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: 0,
  });

  try {
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: config.maxOutputTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.prompt }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "content", text: event.delta.text };
        } else if (event.delta.type === "thinking_delta") {
          yield { type: "thinking", text: event.delta.thinking };
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: "complete",
      text: "",
    };
  } catch (error) {
    throw normalizeProviderError("anthropic", error);
  }
}
