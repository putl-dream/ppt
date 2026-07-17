import OpenAI from "openai";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import { applyResponseContract } from "./response-contract";
import { ensureToolResultPairing } from "./message-pairing";
import type { ProviderTokenUsage } from "@shared/token-usage";
import type {
  AgentModelContentBlock,
  AgentModelImageBlock,
  AgentModelMessage,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  AgentModelToolResultBlock,
  AgentModelToolUseBlock,
  ResolvedAgentModelConfig,
} from "./types";

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function extractOpenAIUsage(value: unknown): ProviderTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens = tokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = tokenCount(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = tokenCount(usage.total_tokens) || inputTokens + outputTokens;
  const details = usage.prompt_tokens_details ?? usage.input_tokens_details;
  const cachedInputTokens = details && typeof details === "object"
    ? tokenCount((details as Record<string, unknown>).cached_tokens)
    : 0;
  if (totalTokens === 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
  };
}

function openAIUsageProperty(value: unknown): { usage?: ProviderTokenUsage } {
  const usage = extractOpenAIUsage(value);
  return usage ? { usage } : {};
}

function toOpenAiImageUrl(image: AgentModelImageBlock): string {
  return `data:${image.mediaType};base64,${image.data}`;
}
function textFromBlocks(blocks: AgentModelContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<AgentModelContentBlock, { type: "text" }> =>
      block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function toOpenAiUserContent(
  blocks: AgentModelContentBlock[],
): OpenAI.Chat.Completions.ChatCompletionContentPart[] | string {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text.trim()) {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push({ type: "image_url", image_url: { url: toOpenAiImageUrl(block) } });
    }
  }
  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

function toolResultText(result: AgentModelToolResultBlock): string {
  const text = result.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const images = result.content.filter((block) => block.type === "image");
  return images.length > 0
    ? `${text}\n\n[${images.length} image attachment(s) follow in a user message]`.trim()
    : text;
}

function toChatMessages(
  messages: AgentModelMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const message of ensureToolResultPairing(messages)) {
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
      out.push({ role: "user", content: toOpenAiUserContent(combined) });
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

function parseToolArguments(
  value: string | undefined,
): { input: Record<string, unknown>; parseError?: string } {
  try {
    const parsed = value ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        input: {},
        parseError: "Tool arguments must decode to a JSON object.",
      };
    }
    return { input: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      input: {},
      parseError: `Invalid tool argument JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
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

function contentFromResponsesOutput(
  response: OpenAI.Responses.Response,
): AgentModelContentBlock[] {
  const text = response.output_text.trim();
  const toolCalls: AgentModelToolUseBlock[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "function_call") continue;
    const { input, parseError } = parseToolArguments(item.arguments);
    toolCalls.push({
      type: "tool_use",
      id: item.call_id,
      name: item.name,
      input,
      ...(parseError ? { parseError } : {}),
    });
  }
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...toolCalls,
  ];
}

export async function generateWithOpenAI(
  config: ResolvedAgentModelConfig,
  request: AgentModelRequest,
): Promise<AgentModelResponse> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: 0,
  });

  try {
    const mode = config.openaiApiMode ?? "responses";
    const maxOutputTokens = request.maxOutputTokens ?? config.maxOutputTokens;
    const systemPrompt = applyResponseContract(request.systemPrompt, request.responseContract);

    if (mode === "chat-completions" || (request.tools?.length && request.messages)) {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
          ...(request.messages
            ? toChatMessages(request.messages)
            : [{ role: "user" as const, content: request.prompt }]),
        ],
        max_tokens: maxOutputTokens,
        ...(request.outputFormat?.type === "json_schema"
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: {
                  name: request.outputFormat.name,
                  description: request.outputFormat.description,
                  schema: request.outputFormat.schema,
                  strict: request.outputFormat.strict ?? true,
                },
              },
            }
          : {}),
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
        ...(request.requiredToolName
          ? {
              tool_choice: {
                type: "function" as const,
                function: { name: request.requiredToolName },
              },
            }
          : {}),
      }, { signal: request.signal });
      const choice = response.choices[0];
      const content = contentFromChatChoice(choice);
      if (content.length === 0) {
        throw new AgentGatewayError("OpenAI returned an empty response.", "empty-response", "openai");
      }
      return {
        provider: "openai",
        model: config.model,
        content,
        requestId: response._request_id ?? undefined,
        stopReason: choice?.finish_reason ?? undefined,
        ...openAIUsageProperty(response.usage),
      };
    }

    const response = await client.responses.create({
      model: config.model,
      instructions: systemPrompt,
      input: request.prompt,
      max_output_tokens: maxOutputTokens,
      ...(request.outputFormat?.type === "json_schema"
        ? {
            text: {
              format: {
                type: "json_schema" as const,
                name: request.outputFormat.name,
                description: request.outputFormat.description,
                schema: request.outputFormat.schema,
                strict: request.outputFormat.strict ?? true,
              },
            },
          }
        : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function" as const,
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
              strict: true,
            })),
          }
        : {}),
      ...(request.requiredToolName
        ? {
            tool_choice: {
              type: "function" as const,
              name: request.requiredToolName,
            },
          }
        : {}),
    }, { signal: request.signal });
    const content = contentFromResponsesOutput(response);
    if (content.length === 0) {
      throw new AgentGatewayError("OpenAI returned an empty response.", "empty-response", "openai");
    }
    return {
      provider: "openai",
      model: config.model,
      content,
      requestId: response._request_id ?? undefined,
      ...openAIUsageProperty(response.usage),
    };
  } catch (error) {
    throw normalizeProviderError("openai", error, request.signal);
  }
}

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
    const systemPrompt = applyResponseContract(request.systemPrompt, request.responseContract);

    if (request.tools?.length || request.outputFormat?.type === "json_schema" || mode === "responses") {
      const response = await generateWithOpenAI(config, request);
      const text = textFromBlocks(response.content);
      if (text) yield { type: "text_delta", text };
      yield {
        type: "complete",
        content: response.content,
        stopReason: response.stopReason,
        ...(response.usage ? { usage: response.usage } : {}),
      };
      return;
    }

    const stream = await client.chat.completions.create({
      model: config.model,
      messages: [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        ...(request.messages
          ? toChatMessages(request.messages)
          : [{ role: "user" as const, content: request.prompt }]),
      ],
      max_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
      stream: true,
      stream_options: { include_usage: true },
    }, { signal: request.signal });

    let text = "";
    let finishReason: string | undefined;
    let usage: ProviderTokenUsage | undefined;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        yield { type: "text_delta", text: delta };
      }
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason ?? undefined;
      }
      usage = extractOpenAIUsage(chunk.usage) ?? usage;
    }
    yield {
      type: "complete",
      content: text ? [{ type: "text", text }] : [],
      stopReason: finishReason,
      ...(usage ? { usage } : {}),
    };
  } catch (error) {
    throw normalizeProviderError("openai", error, request.signal);
  }
}
