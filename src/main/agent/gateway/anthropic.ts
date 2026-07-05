import Anthropic from "@anthropic-ai/sdk";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import { applyResponseContract } from "./response-contract";
import type {
  AgentModelImageBlock,
  AgentModelMessage,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  AgentModelThinkingBlock,
  AgentModelToolCall,
  AgentModelToolResult,
  ResolvedAgentModelConfig,
} from "./types";

function toAnthropicImageBlock(image: AgentModelImageBlock): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: image.mediaType,
      data: image.data,
    },
  };
}

function toAnthropicToolResultContent(result: AgentModelToolResult): Anthropic.ToolResultBlockParam["content"] {
  if (!result.images?.length) return result.content;
  const blocks: Anthropic.ToolResultBlockParam["content"] & Array<unknown> = [
    { type: "text", text: result.content },
    ...result.images.map(toAnthropicImageBlock),
  ];
  return blocks as Anthropic.ToolResultBlockParam["content"];
}

/** Build Anthropic messages from structured multi-turn messages (native tool-use path). */
function toAnthropicMessages(messages: AgentModelMessage[]): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    if (message.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      // thinking 块必须置于 text / tool_use 之前，且原样保留 signature，
      // 否则开启 thinking 的多轮 tool-use 请求会被 API 拒绝。
      for (const block of message.thinkingBlocks ?? []) {
        blocks.push(
          block.type === "thinking"
            ? { type: "thinking", thinking: block.thinking, signature: block.signature }
            : { type: "redacted_thinking", data: block.data },
        );
      }
      if (message.content?.trim()) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.args });
      }
      return { role: "assistant", content: blocks };
    }

    const userBlocks: Anthropic.ContentBlockParam[] = [];
    for (const result of message.toolResults ?? []) {
      userBlocks.push({
        type: "tool_result",
        tool_use_id: result.toolCallId,
        content: toAnthropicToolResultContent(result),
        ...(result.isError ? { is_error: true } : {}),
      });
    }
    if (message.content?.trim()) {
      userBlocks.push({ type: "text", text: message.content });
    }
    for (const image of message.images ?? []) {
      userBlocks.push(toAnthropicImageBlock(image));
    }
    if (userBlocks.length) {
      return { role: "user", content: userBlocks };
    }

    return { role: "user", content: message.content ?? "" };
  });
}

/**
 * Extract thinking / redacted_thinking blocks so they can be replayed on the
 * next request. Anthropic rejects a follow-up tool-use turn whose preceding
 * assistant message drops these blocks (or their signatures).
 */
function extractThinkingBlocks(content: unknown): AgentModelThinkingBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: AgentModelThinkingBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const candidate = block as { type?: unknown; thinking?: unknown; signature?: unknown; data?: unknown };
    if (candidate.type === "thinking" && typeof candidate.thinking === "string") {
      blocks.push({
        type: "thinking",
        thinking: candidate.thinking,
        signature: typeof candidate.signature === "string" ? candidate.signature : "",
      });
    } else if (candidate.type === "redacted_thinking" && typeof candidate.data === "string") {
      blocks.push({ type: "redacted_thinking", data: candidate.data });
    }
  }
  return blocks;
}

/** Extract tool_use blocks from an Anthropic response. */
function extractToolCalls(content: unknown): AgentModelToolCall[] {
  if (!Array.isArray(content)) return [];
  const calls: AgentModelToolCall[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "tool_use") {
      const tool = block as { id?: unknown; name?: unknown; input?: unknown };
      calls.push({
        id: String(tool.id ?? ""),
        name: String(tool.name ?? ""),
        args: (tool.input && typeof tool.input === "object" ? tool.input : {}) as Record<string, unknown>,
      });
    }
  }
  return calls;
}

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
    const systemPrompt = applyResponseContract(request.systemPrompt, request.responseContract);

    // 原生 tool-use 分支：提供 tools 时透传，用结构化 messages 承载多轮对话。
    if (request.tools?.length) {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
        system: systemPrompt,
        messages: request.messages
          ? toAnthropicMessages(request.messages)
          : [{ role: "user", content: request.prompt }],
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        })),
      }, { signal: request.signal });

      const toolCalls = extractToolCalls(response.content);
      const thinkingBlocks = extractThinkingBlocks(response.content);
      const text = extractResponseText(response);
      if (!text && toolCalls.length === 0) {
        throw new AgentGatewayError(
          `Anthropic returned no usable content (stop_reason=${response.stop_reason ?? "unknown"}).`,
          "empty-response",
          "anthropic",
        );
      }
      return {
        provider: "anthropic",
        model: config.model,
        text,
        toolCalls,
        ...(thinkingBlocks.length ? { thinkingBlocks } : {}),
        requestId: response._request_id ?? undefined,
        stopReason: response.stop_reason ?? undefined,
      };
    }

    let maxTokens = request.maxOutputTokens ?? config.maxOutputTokens;
    let response = await client.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: request.prompt }],
    }, { signal: request.signal });
    let text = extractResponseText(response);

    const exhaustedDuringThinking = !text &&
      (response.stop_reason === "max_tokens" || hasThinkingContent(response));
    if (exhaustedDuringThinking && maxTokens < 8_192) {
      maxTokens = Math.min(maxTokens * 2, 8_192);
      response = await client.messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: request.prompt }],
      }, { signal: request.signal });
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
    throw normalizeProviderError("anthropic", error, request.signal);
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
    const useTools = Boolean(request.tools?.length);
    const systemPrompt = applyResponseContract(request.systemPrompt, request.responseContract);
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
      system: systemPrompt,
      messages: useTools && request.messages
        ? toAnthropicMessages(request.messages)
        : [{ role: "user", content: request.prompt }],
      ...(useTools
        ? {
            tools: request.tools!.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    }, { signal: request.signal });

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
    const toolCalls = extractToolCalls(finalMessage.content);
    const thinkingBlocks = extractThinkingBlocks(finalMessage.content);
    yield {
      type: "complete",
      text: "",
      stopReason: finalMessage.stop_reason ?? undefined,
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(thinkingBlocks.length ? { thinkingBlocks } : {}),
    };
  } catch (error) {
    throw normalizeProviderError("anthropic", error, request.signal);
  }
}
