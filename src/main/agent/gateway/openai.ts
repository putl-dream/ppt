import OpenAI from "openai";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import type {
  AgentModelImageBlock,
  AgentModelMessage,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  AgentModelToolCall,
  AgentModelToolResult,
  ResolvedAgentModelConfig,
} from "./types";

function toOpenAiImageUrl(image: AgentModelImageBlock): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

function toOpenAiUserContent(
  text: string | undefined,
  images: AgentModelImageBlock[] | undefined,
): OpenAI.Chat.Completions.ChatCompletionContentPart[] | string {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (text?.trim()) {
    parts.push({ type: "text", text });
  }
  for (const image of images ?? []) {
    parts.push({
      type: "image_url",
      image_url: { url: toOpenAiImageUrl(image) },
    });
  }
  if (parts.length === 0) return text ?? "";
  if (parts.length === 1 && parts[0].type === "text") return text ?? "";
  return parts;
}

function toOpenAiToolResultContent(result: AgentModelToolResult): string {
  if (!result.images?.length) return result.content;
  return `${result.content}\n\n[${result.images.length} slide thumbnail(s) attached in a follow-up user message]`;
}

/** Build Chat Completions messages from structured multi-turn messages. */
function toChatMessages(
  messages: AgentModelMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content ?? "",
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      });
    } else if (message.toolResults?.length) {
      for (const result of message.toolResults) {
        out.push({
          role: "tool",
          tool_call_id: result.toolCallId,
          content: toOpenAiToolResultContent(result),
        });
      }
      if (message.content?.trim() || message.images?.length) {
        out.push({
          role: "user",
          content: toOpenAiUserContent(message.content, message.images),
        });
      } else if (message.toolResults.some((result) => result.images?.length)) {
        const images = message.toolResults.flatMap((result) => result.images ?? []);
        out.push({
          role: "user",
          content: toOpenAiUserContent("Slide thumbnails from the previous tool result:", images),
        });
      }
    } else {
      out.push({
        role: "user",
        content: toOpenAiUserContent(message.content, message.images),
      });
    }
  }
  return out;
}

/** Parse Chat Completions tool_calls into the gateway shape. */
function parseChatToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): AgentModelToolCall[] {
  if (!toolCalls?.length) return [];
  const out: AgentModelToolCall[] = [];
  for (const call of toolCalls) {
    if (call.type !== "function") continue;
    let args: Record<string, unknown> = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      args = {};
    }
    out.push({ id: call.id, name: call.function.name, args });
  }
  return out;
}

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
    let toolCalls: AgentModelToolCall[] = [];

    // 原生 tool-use：Responses 模式的 tool schema 结构差异较大，统一走
    // Chat Completions 承载 tool-use，纯文本仍按配置模式。
    if (request.tools?.length) {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          ...(request.systemPrompt
            ? [{ role: "system" as const, content: request.systemPrompt }]
            : []),
          ...(request.messages
            ? toChatMessages(request.messages)
            : [{ role: "user" as const, content: request.prompt }]),
        ],
        max_tokens: maxOutputTokens,
        tools: request.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      }, { signal: request.signal });
      const choice = response.choices[0];
      text = (choice?.message.content ?? "").trim();
      toolCalls = parseChatToolCalls(choice?.message.tool_calls);
      requestId = response._request_id ?? undefined;
      stopReason = choice?.finish_reason ?? undefined;

      if (!text && toolCalls.length === 0) {
        throw new AgentGatewayError("OpenAI returned an empty response.", "empty-response", "openai");
      }
      return {
        provider: "openai",
        model: config.model,
        text,
        toolCalls,
        requestId,
        stopReason,
      };
    }

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

    // 原生 tool-use 走非流式（tool_calls 的增量拼接不适合逐块回显），
    // 一次性拿到结果后按 chunk 形态回吐，工具调用挂在 complete chunk。
    if (request.tools?.length) {
      const response = await generateWithOpenAI(config, request);
      if (response.text) {
        yield { type: "content", text: response.text };
      }
      yield {
        type: "complete",
        text: "",
        stopReason: response.stopReason,
        ...(response.toolCalls?.length ? { toolCalls: response.toolCalls } : {}),
      };
      return;
    }

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
