import type { AgentModelSelection } from "@shared/agent";
import { resolveAgentGatewayConfig, type AgentGatewayConfig } from "@shared/agent-gateway-config";
import type {
  AgentModelGateway,
  AgentModelMessage,
  AgentModelStreamChunk,
  AgentModelThinkingBlock,
  AgentModelToolCall,
  AgentResponseContract,
  AgentToolSchema,
} from "../gateway/types";
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
import {
  textFromContentBlocks,
  thinkingFromContentBlocks,
  toolCallsFromContentBlocks,
} from "../gateway/content-blocks";

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
  /**
   * 原生 tool-use 工具清单。提供时透传给 gateway 激活 tool-use 分支；
   * 省略则维持文本 JSON 协议。
   */
  tools?: AgentToolSchema[];
  /** 原生 tool-use 多轮消息；与 tools 配套使用。 */
  messages?: AgentModelMessage[];
  stream?: {
    onChunk?: (chunk: AgentModelStreamChunk) => void;
    onThinkingChunk?: (text: string) => void;
  };
  onRecovery?: (message: string) => void;
}

export interface ModelCallRecoveryResult {
  text: string;
  stopReason?: string;
  modelUsed?: AgentModelSelection;
  recoveryNotes: string[];
  /** 原生 tool-use 返回的工具调用；文本路径下为空。 */
  toolCalls?: AgentModelToolCall[];
  /** 扩展思考块，回传到下一回合的 assistant 消息以满足 API 校验。 */
  thinkingBlocks?: AgentModelThinkingBlock[];
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
        "Your previous response was truncated by max_tokens. Continue exactly where you left off. "
        + "Do not repeat content already written. Return one complete JSON object.",
      partialOutput,
    },
  });
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
): Promise<{
  text: string;
  stopReason?: string;
  toolCalls?: AgentModelToolCall[];
  thinkingBlocks?: AgentModelThinkingBlock[];
}> {
  if (stream?.onChunk || stream?.onThinkingChunk) {
    let text = "";
    let stopReason: string | undefined;
    let toolCalls: AgentModelToolCall[] | undefined;
    let thinkingBlocks: AgentModelThinkingBlock[] | undefined;
    for await (const chunk of gateway.generateTextStream(request, model)) {
      if (chunk.type === "thinking" && chunk.text) {
        stream.onThinkingChunk?.(chunk.text);
      } else if (chunk.type === "content" && chunk.text) {
        text += chunk.text;
        stream.onChunk?.(chunk);
      } else if (chunk.type === "complete") {
        stopReason = chunk.stopReason;
        if (chunk.toolCalls?.length) toolCalls = chunk.toolCalls;
        if (chunk.thinkingBlocks?.length) thinkingBlocks = chunk.thinkingBlocks;
      }
    }
    return { text, stopReason, toolCalls, thinkingBlocks };
  }

  const response = await gateway.generateText(request, model);
  return {
    text: response.text || textFromContentBlocks(response.contentBlocks),
    stopReason: response.stopReason,
    toolCalls: response.toolCalls?.length
      ? response.toolCalls
      : toolCallsFromContentBlocks(response.contentBlocks),
    thinkingBlocks: response.thinkingBlocks?.length
      ? response.thinkingBlocks
      : thinkingFromContentBlocks(response.contentBlocks),
  };
}

/**
 * Call the model with automatic recovery for transient API failures,
 * context overflow, and output truncation.
 */
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

  const notify = (message: string) => {
    recoveryNotes.push(message);
    options.onRecovery?.(message);
    logger.info("model.recovery", { message, model: modelSelection });
  };

  for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) {
      throw new Error("Run aborted by user.");
    }

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
        onProgress: notify,
      });
      payload = prepared.payload;
      compactHistoryFailures = prepared.compactHistoryFailures;
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
          messages: options.messages,
        },
        modelSelection,
        continuationPartial ? undefined : options.stream,
      );

      // 原生 tool-use：返回工具调用即视为完整响应，跳过文本截断/续写逻辑。
      if (response.toolCalls?.length) {
        return {
          text: response.text,
          stopReason: response.stopReason,
          toolCalls: response.toolCalls,
          thinkingBlocks: response.thinkingBlocks,
          modelUsed: modelSelection,
          recoveryNotes,
        };
      }

      if (!response.text.trim()) {
        throw new AgentGatewayError("Model returned an empty response.", "empty-response");
      }

      if (isOutputTruncated(response.stopReason)) {
        const currentTokens = maxOutputTokens ?? defaultOutputTokens;
        const nextTokens = nextOutputTokenUpgrade(currentTokens);
        if (nextTokens !== undefined) {
          maxOutputTokens = nextTokens;
          notify(`输出被截断，提升 max_tokens 至 ${nextTokens} 后重试。`);
          continue;
        }
        if (!continuationPartial) {
          continuationPartial = response.text;
          notify("输出截断后启用续写提示重试。");
          continue;
        }
      }

      return {
        text: response.text,
        stopReason: response.stopReason,
        toolCalls: response.toolCalls,
        thinkingBlocks: response.thinkingBlocks,
        modelUsed: modelSelection,
        recoveryNotes,
      };
    } catch (error) {
      lastError = error;
      if (isAbortError(error, options.signal)) {
        throw error instanceof Error ? error : new Error("Run aborted by user.");
      }

      const recovery = classifyGatewayRecovery(error);
      if (recovery === "non-recoverable") {
        throw error;
      }

      if (error instanceof AgentGatewayError && error.code === "overloaded") {
        consecutiveOverloaded += 1;
      } else if (recovery === "retry-backoff") {
        consecutiveOverloaded = 0;
      }

      if (recovery === "compact-context" && !emergencyTrimmed) {
        emergencyTrimmed = true;
        payload = emergencyTrimContext(payload);
        notify("上下文超限，已应急裁剪后重试。");
        continue;
      }

      if (
        consecutiveOverloaded >= CONSECUTIVE_OVERLOAD_SWITCH
        && modelSelection
      ) {
        const fallback = resolveFallbackModelSelection(modelSelection, gatewayConfig);
        if (fallback) {
          modelSelection = fallback;
          consecutiveOverloaded = 0;
          notify(`连续过载，切换备用模型 ${fallback.provider}/${fallback.model}。`);
          continue;
        }
      }

      const retryAfterMs = extractRetryAfterMs(error);
      notify(
        retryAfterMs
          ? `临时故障，按 Retry-After 等待后重试（第 ${attempt} 次）。`
          : `临时故障，指数退避后重试（第 ${attempt} 次）。`,
      );
      await backoffBeforeRetry({
        attempt,
        retryAfterMs,
        signal: options.signal,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Model call failed after recovery attempts.");
}
