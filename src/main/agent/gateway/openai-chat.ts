import OpenAI from "openai";
import type { DriverResolvedConfig } from "./config";
import {
  completeChunkFromResponse,
  openAIUsageProperty,
  parseToolArguments,
  textFromBlocks,
  toOpenAIImageUrl,
  toolResultText,
  type OpenAIClient,
  type OpenAIModeDriver,
} from "./openai-common";
import type {
  AgentModelContentBlock,
  AgentModelImageBlock,
  AgentModelMessage,
  AgentModelResponse,
  AgentModelStreamChunk,
  AgentModelToolResultBlock,
  AgentModelToolUseBlock,
  PreparedAgentModelRequest,
  StopReason,
} from "./types";

function toStopReasonFromChat(finishReason?: string | null): StopReason | undefined {
  if (!finishReason) return undefined;
  switch (finishReason) {
    case "stop":          return "end";
    case "length":        return "max_tokens";
    case "tool_calls":
    case "function_call": return "tool_use";
    default:              return "other";
  }
}

function toOpenAIUserContent(
  blocks: AgentModelContentBlock[],
): OpenAI.Chat.Completions.ChatCompletionContentPart[] | string {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text.trim()) {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push({ type: "image_url", image_url: { url: toOpenAIImageUrl(block) } });
    }
  }
  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

function toChatMessages(
  messages: AgentModelMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      const toolUses = message.content.filter(
        (block): block is AgentModelToolUseBlock => block.type === "tool_use",
      );
      out.push({
        role: "assistant",
        content: textFromBlocks(message.content),
        ...(toolUses.length
          ? {
              tool_calls: toolUses.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      });
      continue;
    }

    const toolResults = message.content.filter(
      (block): block is AgentModelToolResultBlock => block.type === "tool_result",
    );
    for (const result of toolResults) {
      out.push({
        role: "tool",
        tool_call_id: result.toolUseId,
        content: toolResultText(result),
      });
    }

    const userBlocks = message.content.filter((block) =>
      block.type === "text" || block.type === "image");
    const resultImages = toolResults.flatMap((result) =>
      result.content.filter((block): block is AgentModelImageBlock => block.type === "image"));
    const combined = [...userBlocks, ...resultImages];
    if (combined.length > 0) {
      out.push({ role: "user", content: toOpenAIUserContent(combined) });
    }
  }
  return out;
}

function parseChatToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): AgentModelToolUseBlock[] {
  if (!toolCalls?.length) return [];
  const out: AgentModelToolUseBlock[] = [];
  for (const call of toolCalls) {
    if (call.type !== "function") continue;
    const { input, parseError } = parseToolArguments(call.function.arguments);
    out.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input,
      ...(parseError ? { parseError } : {}),
    });
  }
  return out;
}

function contentFromChatChoice(
  choice: OpenAI.Chat.Completions.ChatCompletion.Choice | undefined,
): AgentModelContentBlock[] {
  const text = (choice?.message.content ?? "").trim();
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...parseChatToolCalls(choice?.message.tool_calls),
  ];
}

function chatRequestBase(
  config: DriverResolvedConfig,
  request: PreparedAgentModelRequest,
): Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, "stream"> {
  return {
    model: config.model,
    messages: [
      ...(request.systemPrompt
        ? [{ role: "system" as const, content: request.systemPrompt }]
        : []),
      ...toChatMessages(request.messages),
    ],
    max_tokens: request.maxOutputTokens,
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
              strict: true,
            },
          })),
        }
      : {}),
  };
}

type ChatCompletionWithRequestId = OpenAI.Chat.Completions.ChatCompletion & {
  _request_id?: string | null;
};

function responseFromChatCompletion(
  config: DriverResolvedConfig,
  response: ChatCompletionWithRequestId,
): AgentModelResponse {
  const choice = response.choices[0];
  return {
    provider: "openai",
    model: config.model,
    content: contentFromChatChoice(choice),
    requestId: response._request_id ?? undefined,
    stopReason: toStopReasonFromChat(choice?.finish_reason),
    ...openAIUsageProperty(response.usage),
  };
}

async function generateWithChatCompletions(
  client: OpenAIClient,
  config: DriverResolvedConfig,
  request: PreparedAgentModelRequest,
): Promise<AgentModelResponse> {
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
    chatRequestBase(config, request);
  const response = await client.chat.completions.create(params, { signal: request.signal });
  return responseFromChatCompletion(config, response);
}

async function* generateStreamWithChatCompletions(
  client: OpenAIClient,
  config: DriverResolvedConfig,
  request: PreparedAgentModelRequest,
): AsyncGenerator<AgentModelStreamChunk> {
  const params = {
    ...chatRequestBase(config, request),
    stream_options: { include_usage: true },
  };
  const stream = client.chat.completions.stream(params, { signal: request.signal });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { type: "text_delta", text: delta };
  }

  const response = await stream.finalChatCompletion();
  yield completeChunkFromResponse(responseFromChatCompletion(config, response));
}

export const openAIChatDriver = {
  generate: generateWithChatCompletions,
  generateStream: generateStreamWithChatCompletions,
} satisfies OpenAIModeDriver;
