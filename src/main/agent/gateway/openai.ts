import OpenAI from "openai";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import type {
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  ResolvedAgentModelConfig,
} from "./types";

export async function generateWithOpenAI(
  config: ResolvedAgentModelConfig,
  request: AgentModelRequest,
): Promise<AgentModelResponse> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    // Keep provider failures visible to the Runtime instead of silently
    // multiplying the configured timeout inside the SDK.
    maxRetries: 0,
  });

  try {
    const mode = config.openaiApiMode ?? "responses";
    let text: string;
    let requestId: string | undefined;
    let stopReason: string | undefined;

    const maxOutputTokens = request.maxOutputTokens ?? config.maxOutputTokens;

    if (mode === "responses") {
      const response = await client.responses.create({
        model: config.model,
        instructions: request.systemPrompt,
        input: request.prompt,
        max_output_tokens: maxOutputTokens,
      }, { signal: request.signal });
      text = response.output_text.trim();
      requestId = response._request_id ?? undefined;
    } else {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          ...(request.systemPrompt
            ? [{ role: "system" as const, content: request.systemPrompt }]
            : []),
          { role: "user", content: request.prompt },
        ],
        max_tokens: maxOutputTokens,
      }, { signal: request.signal });
      text = (response.choices[0]?.message.content ?? "").trim();
      requestId = response._request_id ?? undefined;
      stopReason = response.choices[0]?.finish_reason ?? undefined;
    }

    if (!text) {
      throw new AgentGatewayError("OpenAI returned an empty response.", "empty-response", "openai");
    }
    return {
      provider: "openai",
      model: config.model,
      text,
      requestId,
      stopReason,
    };
  } catch (error) {
    throw normalizeProviderError("openai", error, request.signal);
  }
}

/**
 * 流式生成文本（OpenAI）
 * 注意：Responses API 暂不支持流式，会降级为非流式后一次性返回
 */
export async function* generateStreamWithOpenAI(
  config: ResolvedAgentModelConfig,
  request: AgentModelRequest,
): AsyncGenerator<AgentModelStreamChunk> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: 0,
  });

  try {
    const mode = config.openaiApiMode ?? "responses";

    if (mode === "responses") {
      // Responses API 暂不支持流式，降级到非流式
      const response = await generateWithOpenAI(config, request);
      yield { type: "content", text: response.text };
      yield { type: "complete", text: "", stopReason: response.stopReason };
    } else {
      const maxOutputTokens = request.maxOutputTokens ?? config.maxOutputTokens;
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: [
          ...(request.systemPrompt
            ? [{ role: "system" as const, content: request.systemPrompt }]
            : []),
          { role: "user", content: request.prompt },
        ],
        max_tokens: maxOutputTokens,
        stream: true,
      }, { signal: request.signal });

      let finishReason: string | undefined;
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield { type: "content", text: content };
        }
        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0]?.finish_reason ?? undefined;
        }
      }

      yield { type: "complete", text: "", stopReason: finishReason };
    }
  } catch (error) {
    throw normalizeProviderError("openai", error, request.signal);
  }
}
