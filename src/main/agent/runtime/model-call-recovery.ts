import type { AgentModelSelection } from "@shared/agent";
import { resolveAgentGatewayConfig, type AgentGatewayConfig } from "@shared/agent-gateway-config";
import type {
  AgentModelContentBlock,
  AgentModelGateway,
  AgentModelMessage,
  AgentModelStreamChunk,
  AgentResponseContract,
  AgentToolSchema,
} from "../gateway/types";
import { textFromContentBlocks, toolUseBlocksFromContent } from "../gateway/content-blocks";
import { resolveFallbackModelSelection } from "../gateway/config";
import {
  AgentGatewayError,
  classifyGatewayRecovery,
  isAbortError,
  isOutputTruncated,
} from "../gateway/errors";
import { backoffBeforeRetry, extractRetryAfterMs } from "../gateway/withRetry";
import { emergencyTrimContext, prepareContext } from "./context-compact";
import { createModuleLogger } from "../logger";
import { ensureToolResultPairing } from "../gateway/message-pairing";
import { callTool } from "../gateway/model-calls";

const logger = createModuleLogger("model-call-recovery");
const MAX_RECOVERY_ATTEMPTS = 8;
const TOKEN_UPGRADE_8K = 8_192;
const TOKEN_UPGRADE_64K = 65_536;
const CONSECUTIVE_OVERLOAD_SWITCH = 2;

function readGatewayConfig(gateway: AgentModelGateway): AgentGatewayConfig {
  const reader = gateway as AgentModelGateway & { getGatewayConfig?: () => AgentGatewayConfig };
  return reader.getGatewayConfig?.() ?? resolveAgentGatewayConfig();
}
export interface ModelPromptPayload {
  request?: string;
  task?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  transcript: Array<Record<string, unknown>>;
}

export interface ModelCallRecoveryOptions {
  gateway: AgentModelGateway;
  systemPrompt: string;
  responseContract?: AgentResponseContract;
  promptPayload: ModelPromptPayload;
  model?: AgentModelSelection;
  workspaceRoot?: string;
  threadId?: string;
  signal?: AbortSignal;
  tools?: AgentToolSchema[];
  messages?: AgentModelMessage[];
  stream?: {
    onChunk?: (chunk: AgentModelStreamChunk) => void;
    onThinkingChunk?: (text: string) => void;
  };
  onRecovery?: (message: string) => void;
  onContextPrepared?: (
    payload: ModelPromptPayload,
    notes: string[],
    messages?: AgentModelMessage[],
  ) => void;
}

export interface ModelCallRecoveryResult {
  content: AgentModelContentBlock[];
  stopReason?: string;
  modelUsed?: AgentModelSelection;
  recoveryNotes: string[];
}

function buildPrompt(payload: ModelPromptPayload): string {
  return JSON.stringify(payload);
}

function buildContinuationPrompt(
  originalPayload: ModelPromptPayload,
  partialOutput: string,
): string {
  return JSON.stringify({
    ...originalPayload,
    continuation: {
      instruction:
        "Your previous text response was truncated by max_tokens. Continue exactly where you left off. "
        + "Do not repeat content already written.",
      partialOutput,
    },
  });
}

function compactStructuredMessages(
  messages: AgentModelMessage[] | undefined,
  payload: ModelPromptPayload,
  shouldCompact: boolean,
): AgentModelMessage[] | undefined {
  if (!messages || !shouldCompact || messages.length <= 12) return messages;
  const compactedContext = JSON.stringify(payload);
  const tail = ensureToolResultPairing(messages.slice(-12));
  return [
    {
      role: "user",
      content: [{
        type: "text",
        text: [
          "<compacted_conversation_context>",
          compactedContext,
          "</compacted_conversation_context>",
        ].join("\n"),
      }],
    },
    ...tail,
  ];
}

function nextOutputTokenUpgrade(current: number): number | undefined {
  if (current < TOKEN_UPGRADE_8K) return TOKEN_UPGRADE_8K;
  if (current < TOKEN_UPGRADE_64K) return TOKEN_UPGRADE_64K;
  return undefined;
}

async function invokeGateway(
  gateway: AgentModelGateway,
  request: {
    systemPrompt: string;
    prompt: string;
    signal?: AbortSignal;
    maxOutputTokens?: number;
    responseContract?: AgentResponseContract;
    tools?: AgentToolSchema[];
    messages?: AgentModelMessage[];
  },
  model: AgentModelSelection | undefined,
  stream?: ModelCallRecoveryOptions["stream"],
): Promise<{ content: AgentModelContentBlock[]; stopReason?: string }> {
  if (stream?.onChunk || stream?.onThinkingChunk) {
    let streamedText = "";
    let content: AgentModelContentBlock[] = [];
    let stopReason: string | undefined;
    for await (const chunk of gateway.generateTextStream(request, model)) {
      if (chunk.type === "thinking_delta") {
        stream.onThinkingChunk?.(chunk.thinking);
      } else if (chunk.type === "text_delta") {
        streamedText += chunk.text;
        stream.onChunk?.(chunk);
      } else {
        content = chunk.content;
        stopReason = chunk.stopReason;
      }
    }
    if (content.length === 0 && streamedText) {
      content = [{ type: "text", text: streamedText }];
    }
    return { content, stopReason };
  }

  if (request.tools?.length) {
    const turn = await callTool(gateway, {
      ...request,
      tools: request.tools,
    }, model);
    return {
      content: turn.response.content,
      stopReason: turn.response.stopReason,
    };
  }

  const response = await gateway.generateText(request, model);
  return { content: response.content, stopReason: response.stopReason };
}

export async function callModelWithRecovery(
  options: ModelCallRecoveryOptions,
): Promise<ModelCallRecoveryResult> {
  const recoveryNotes: string[] = [];
  const gatewayConfig = readGatewayConfig(options.gateway);
  const defaultOutputTokens = gatewayConfig.maxOutputTokens;
  let payload: ModelPromptPayload = structuredClone(options.promptPayload);
  let modelSelection = options.model;
  let maxOutputTokens: number | undefined;
  let emergencyTrimmed = false;
  let compactHistoryFailures = 0;
  let continuationPartial: string | undefined;
  let consecutiveOverloaded = 0;
  let lastError: unknown;
  let preparedMessages = options.messages;

  const recordDiagnostic = (message: string) => {
    recoveryNotes.push(message);
    logger.info("model.recovery", { message, model: modelSelection });
  };
  const notify = (diagnostic: string, userMessage = diagnostic) => {
    recordDiagnostic(diagnostic);
    options.onRecovery?.(userMessage);
  };

  for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw new Error("Run aborted by user.");

    if (!continuationPartial) {
      const prepared = await prepareContext({
        payload,
        systemPrompt: options.systemPrompt,
        workspaceRoot: options.workspaceRoot,
        threadId: options.threadId,
        gateway: options.gateway,
        model: modelSelection,
        signal: options.signal,
        compactHistoryFailures,
        onProgress: options.onRecovery,
      });
      prepared.notes.forEach(recordDiagnostic);
      payload = prepared.payload;
      compactHistoryFailures = prepared.compactHistoryFailures;
      preparedMessages = compactStructuredMessages(
        options.messages,
        payload,
        prepared.contextChanged,
      );
      options.onContextPrepared?.(
        structuredClone(payload),
        [...prepared.notes],
        preparedMessages ? structuredClone(preparedMessages) : undefined,
      );
    }

    const prompt = continuationPartial
      ? buildContinuationPrompt(options.promptPayload, continuationPartial)
      : buildPrompt(payload);

    try {
      const response = await invokeGateway(
        options.gateway,
        {
          systemPrompt: options.systemPrompt,
          responseContract: options.responseContract,
          prompt,
          signal: options.signal,
          maxOutputTokens,
          tools: options.tools,
          messages: preparedMessages,
        },
        modelSelection,
        continuationPartial ? undefined : options.stream,
      );

      if (toolUseBlocksFromContent(response.content).length > 0) {
        return {
          content: response.content,
          stopReason: response.stopReason,
          modelUsed: modelSelection,
          recoveryNotes,
        };
      }

      const text = textFromContentBlocks(response.content);
      if (!text) {
        throw new AgentGatewayError("Model returned no text or tool_use content.", "empty-response");
      }

      if (isOutputTruncated(response.stopReason)) {
        const currentTokens = maxOutputTokens ?? defaultOutputTokens;
        const nextTokens = nextOutputTokenUpgrade(currentTokens);
        if (nextTokens !== undefined) {
          maxOutputTokens = nextTokens;
          notify(
            `输出被截断，提升 max_tokens 至 ${nextTokens} 后重试。`,
            "回复内容较长，正在继续生成…",
          );
          continue;
        }
        if (!continuationPartial) {
          continuationPartial = text;
          notify("输出截断后启用续写提示重试。", "回复内容较长，正在继续生成…");
          continue;
        }
      }

      return {
        content: response.content,
        stopReason: response.stopReason,
        modelUsed: modelSelection,
        recoveryNotes,
      };
    } catch (error) {
      lastError = error;
      if (isAbortError(error, options.signal)) {
        throw error instanceof Error ? error : new Error("Run aborted by user.");
      }

      const recovery = classifyGatewayRecovery(error);
      if (recovery === "non-recoverable") throw error;

      if (error instanceof AgentGatewayError && error.code === "overloaded") {
        consecutiveOverloaded += 1;
      } else if (recovery === "retry-backoff") {
        consecutiveOverloaded = 0;
      }

      if (recovery === "compact-context" && !emergencyTrimmed) {
        emergencyTrimmed = true;
        payload = emergencyTrimContext(payload);
        notify("上下文超限，已应急裁剪后重试。", "对话内容较多，整理后正在继续…");
        continue;
      }

      if (consecutiveOverloaded >= CONSECUTIVE_OVERLOAD_SWITCH && modelSelection) {
        const fallback = resolveFallbackModelSelection(modelSelection, gatewayConfig);
        if (fallback) {
          modelSelection = fallback;
          consecutiveOverloaded = 0;
          notify(
            `连续过载，切换备用模型 ${fallback.provider}/${fallback.model}。`,
            "服务暂时繁忙，已切换备用服务继续处理…",
          );
          continue;
        }
      }

      const retryAfterMs = extractRetryAfterMs(error);
      notify(
        retryAfterMs
          ? `临时故障，按 Retry-After 等待后重试（第 ${attempt} 次）。`
          : `临时故障，指数退避后重试（第 ${attempt} 次）。`,
        "服务暂时繁忙，正在重试…",
      );
      await backoffBeforeRetry({ attempt, retryAfterMs, signal: options.signal });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Model call failed after recovery attempts.");
}
