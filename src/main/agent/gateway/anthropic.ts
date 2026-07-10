import Anthropic from "@anthropic-ai/sdk";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import { applyResponseContract } from "./response-contract";
import { ensureToolResultPairing } from "./message-pairing";
import type {
  AgentModelContentBlock,
  AgentModelImageBlock,
  AgentModelMessage,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  AgentModelToolResultBlock,
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
function toAnthropicToolResultContent(
  result: AgentModelToolResultBlock,
): Anthropic.ToolResultBlockParam["content"] {
  return result.content.map((block) =>
    block.type === "text"
      ? { type: "text" as const, text: block.text }
      : toAnthropicImageBlock(block));
}

function toAnthropicBlock(block: AgentModelContentBlock): Anthropic.ContentBlockParam | null {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      return { type: "thinking", thinking: block.thinking, signature: block.signature };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: block.data };
    case "image":
      return toAnthropicImageBlock(block);
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: toAnthropicToolResultContent(block),
        ...(block.isError ? { is_error: true } : {}),
      };
    case "server_tool":
      return block.data as Anthropic.ContentBlockParam;
  }
}

function toAnthropicMessages(messages: AgentModelMessage[]): Anthropic.MessageParam[] {
  return ensureToolResultPairing(messages).map((message) => ({
    role: message.role,
    content: message.content
      .map(toAnthropicBlock)
      .filter((block): block is Anthropic.ContentBlockParam => block !== null),
  }));
}

function extractImageBlock(block: Record<string, unknown>): AgentModelImageBlock | undefined {
  const source = block.source;
  if (!source || typeof source !== "object") return undefined;
  const candidate = source as Record<string, unknown>;
  if (candidate.type !== "base64" || typeof candidate.data !== "string") return undefined;
  const mediaType = candidate.media_type;
  if (
    mediaType !== "image/png"
    && mediaType !== "image/jpeg"
    && mediaType !== "image/webp"
    && mediaType !== "image/gif"
  ) return undefined;
  return { type: "image", mediaType, data: candidate.data };
}

function extractContentBlocks(content: unknown): AgentModelContentBlock[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks: AgentModelContentBlock[] = [];
  for (const value of content) {
    if (!value || typeof value !== "object") continue;
    const block = value as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "unknown";
    if (type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
    } else if (type === "thinking" && typeof block.thinking === "string") {
      blocks.push({
        type: "thinking",
        thinking: block.thinking,
        signature: typeof block.signature === "string" ? block.signature : "",
      });
    } else if (type === "redacted_thinking" && typeof block.data === "string") {
      blocks.push({ type: "redacted_thinking", data: block.data });
    } else if (type === "tool_use") {
      blocks.push({
        type: "tool_use",
        id: typeof block.id === "string" ? block.id : "",
        name: typeof block.name === "string" ? block.name : "",
        input: block.input && typeof block.input === "object" && !Array.isArray(block.input)
          ? block.input as Record<string, unknown>
          : {},
      });
    } else if (type === "image") {
      const image = extractImageBlock(block);
      if (image) blocks.push(image);
    } else {
      blocks.push({ type: "server_tool", providerType: type, data: value });
    }
  }
  return blocks;
}

function hasUsableContent(blocks: AgentModelContentBlock[]): boolean {
  return blocks.some((block) =>
    block.type === "tool_use"
    || block.type === "server_tool"
    || (block.type === "text" && block.text.trim().length > 0));
}

function hasThinkingContent(blocks: AgentModelContentBlock[]): boolean {
  return blocks.some((block) => block.type === "thinking" || block.type === "redacted_thinking");
}

export async function generateWithAnthropic(
  config: ResolvedAgentModelConfig,
  request: AgentModelRequest,
): Promise<AgentModelResponse> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: 0,
  });

  try {
    const systemPrompt = applyResponseContract(request.systemPrompt, request.responseContract);
    const create = (maxTokens: number) => client.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: request.messages
        ? toAnthropicMessages(request.messages)
        : [{ role: "user", content: request.prompt }],
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    }, { signal: request.signal });

    let maxTokens = request.maxOutputTokens ?? config.maxOutputTokens;
    let response = await create(maxTokens);
    let content = extractContentBlocks(response.content);

    if (
      !hasUsableContent(content)
      && hasThinkingContent(content)
      && maxTokens < 8_192
    ) {
      maxTokens = Math.min(maxTokens * 2, 8_192);
      response = await create(maxTokens);
      content = extractContentBlocks(response.content);
    }

    if (!hasUsableContent(content)) {
      throw new AgentGatewayError(
        `Anthropic returned no usable content (stop_reason=${response.stop_reason ?? "unknown"}).`,
        "empty-response",
        "anthropic",
      );
    }

    return {
      provider: "anthropic",
      model: config.model,
      content,
      requestId: response._request_id ?? undefined,
      stopReason: response.stop_reason ?? undefined,
    };
  } catch (error) {
    throw normalizeProviderError("anthropic", error, request.signal);
  }
}

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
    const systemPrompt = applyResponseContract(request.systemPrompt, request.responseContract);
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
      system: systemPrompt,
      messages: request.messages
        ? toAnthropicMessages(request.messages)
        : [{ role: "user", content: request.prompt }],
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    }, { signal: request.signal });

    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") {
        yield { type: "text_delta", text: event.delta.text, index: event.index };
      } else if (event.delta.type === "thinking_delta") {
        yield { type: "thinking_delta", thinking: event.delta.thinking, index: event.index };
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: "complete",
      content: extractContentBlocks(finalMessage.content),
      stopReason: finalMessage.stop_reason ?? undefined,
    };
  } catch (error) {
    throw normalizeProviderError("anthropic", error, request.signal);
  }
}
