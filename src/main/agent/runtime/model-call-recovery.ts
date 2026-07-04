import type { AgentModelSelection } from "@shared/agent";
import type { AgentModelGateway, AgentModelStreamChunk } from "../gateway/types";
import { resolveFallbackModelSelection } from "../gateway/config";
import {
  AgentGatewayError,
  classifyGatewayRecovery,
  isAbortError,
  isOutputTruncated,
} from "../gateway/errors";
import { backoffBeforeRetry, extractRetryAfterMs } from "../gateway/withRetry";
import { compactConversation, compactTranscript } from "./transcript-compact";
import { createModuleLogger } from "../logger";

const logger = createModuleLogger("model-call-recovery");

const MAX_RECOVERY_ATTEMPTS = 8;
const DEFAULT_OUTPUT_TOKENS = 16_384;
const TOKEN_UPGRADE_8K = 8_192;
const TOKEN_UPGRADE_64K = 65_536;
const CONSECUTIVE_OVERLOAD_SWITCH = 2;

export interface ModelPromptPayload {
  request?: string;
  task?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  transcript: Array<Record<string, unknown>>;
}

export interface ModelCallRecoveryOptions {
  gateway: AgentModelGateway;
  systemPrompt: string;
  promptPayload: ModelPromptPayload;
  model?: AgentModelSelection;
  signal?: AbortSignal;
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
  },
  model: AgentModelSelection | undefined,
  stream?: ModelCallRecoveryOptions["stream"],
): Promise<{ text: string; stopReason?: string }> {
  if (stream?.onChunk || stream?.onThinkingChunk) {
    let text = "";
    let stopReason: string | undefined;
    for await (const chunk of gateway.generateTextStream(request, model)) {
      if (chunk.type === "thinking" && chunk.text) {
        stream.onThinkingChunk?.(chunk.text);
      } else if (chunk.type === "content" && chunk.text) {
        text += chunk.text;
        stream.onChunk?.(chunk);
      } else if (chunk.type === "complete") {
        stopReason = chunk.stopReason;
      }
    }
    return { text, stopReason };
  }

  const response = await gateway.generateText(request, model);
  return { text: response.text, stopReason: response.stopReason };
}

/**
 * Call the model with automatic recovery for transient API failures,
 * context overflow, and output truncation.
 */
export async function callModelWithRecovery(
  options: ModelCallRecoveryOptions,
): Promise<ModelCallRecoveryResult> {
  const recoveryNotes: string[] = [];
  let payload: ModelPromptPayload = structuredClone(options.promptPayload);
  let modelSelection = options.model;
  let maxOutputTokens: number | undefined;
  let compacted = false;
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

    const prompt = continuationPartial
      ? buildContinuationPrompt(options.promptPayload, continuationPartial)
      : buildPrompt(payload);

    try {
      const response = await invokeGateway(
        options.gateway,
        {
          systemPrompt: options.systemPrompt,
          prompt,
          signal: options.signal,
          maxOutputTokens,
        },
        modelSelection,
        continuationPartial ? undefined : options.stream,
      );

      if (!response.text.trim()) {
        throw new AgentGatewayError("Model returned an empty response.", "empty-response");
      }

      if (isOutputTruncated(response.stopReason)) {
        const currentTokens = maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS;
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

      if (recovery === "compact-context" && !compacted) {
        compacted = true;
        payload = {
          ...payload,
          conversation: compactConversation(payload.conversation),
          transcript: compactTranscript(payload.transcript),
        };
        notify("上下文超限，已压缩 transcript 后重试。");
        continue;
      }

      if (
        consecutiveOverloaded >= CONSECUTIVE_OVERLOAD_SWITCH
        && modelSelection
      ) {
        const fallback = resolveFallbackModelSelection(modelSelection);
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
