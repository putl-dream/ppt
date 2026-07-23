import type { ModelPromptPayload } from "../turns/model-call-recovery";
import { resolveContextSoftTokenThreshold, resolveContextTokenThreshold } from "./config";
import { compactHistory } from "./compact-history";
import { estimatePromptTokens } from "./estimate-tokens";
import { microCompactTranscript } from "./micro-compact";
import { snipCompactConversation, snipCompactTranscript } from "./snip-compact";
import { toolResultBudget } from "./tool-result-budget";
import type { ContextCompactResult, PrepareContextOptions } from "./types";

export const CONTEXT_TOOL_RESULTS_COMPACTED_USER_MESSAGE =
  "上下文空间接近阈值，已精简较早的工具结果并保留可恢复摘要…";
export const CONTEXT_HISTORY_COMPACTED_USER_MESSAGE =
  "上下文空间接近上限，已总结较早的会话记录并继续处理…";
export const CONTEXT_LARGE_RESULTS_PERSISTED_USER_MESSAGE =
  "已将较大的工具结果保存到工作区，正在继续处理…";

function contextProgressMessage(notes: string[]): string | undefined {
  if (notes.some((note) => /^L4 compact_history:/i.test(note))) {
    return CONTEXT_HISTORY_COMPACTED_USER_MESSAGE;
  }
  if (notes.some((note) => /^L1 snip_compact:/i.test(note))) {
    return CONTEXT_HISTORY_COMPACTED_USER_MESSAGE;
  }
  if (notes.some((note) => /^L2 micro_compact:/i.test(note))) {
    return CONTEXT_TOOL_RESULTS_COMPACTED_USER_MESSAGE;
  }
  if (notes.some((note) => /^(?:L3 tool_result_budget:|Persisted oversized tool result)/i.test(note))) {
    return CONTEXT_LARGE_RESULTS_PERSISTED_USER_MESSAGE;
  }
  return undefined;
}

/**
 * Persist exceptionally large results immediately, then delay lossy compaction
 * until the prompt approaches its configured token threshold.
 */
export async function prepareContext(
  options: PrepareContextOptions,
): Promise<ContextCompactResult> {
  const notes: string[] = [];
  let compactHistoryFailures = options.compactHistoryFailures ?? 0;

  let payload: ModelPromptPayload = structuredClone(options.payload);

  const budgetResult = await toolResultBudget(payload.transcript, options.workspaceRoot);
  payload = { ...payload, transcript: budgetResult.transcript };
  notes.push(...budgetResult.notes);

  const tokenThreshold = options.tokenThreshold ?? resolveContextTokenThreshold();
  const softTokenThreshold = Math.min(
    options.softTokenThreshold ?? resolveContextSoftTokenThreshold(tokenThreshold),
    tokenThreshold,
  );
  let estimatedTokens = estimatePromptTokens(options.systemPrompt, payload);

  if (estimatedTokens > softTokenThreshold) {
    const beforeMicro = JSON.stringify(payload.transcript).length;
    payload = {
      ...payload,
      transcript: microCompactTranscript(payload.transcript),
    };
    const afterMicro = JSON.stringify(payload.transcript).length;
    if (afterMicro < beforeMicro) {
      notes.push(
        `L2 micro_compact: reduced older tool results by ${beforeMicro - afterMicro} characters.`,
      );
      estimatedTokens = estimatePromptTokens(options.systemPrompt, payload);
    }
  }

  if (estimatedTokens > tokenThreshold && options.gateway) {
    const historyResult = await compactHistory({
      payload,
      workspaceRoot: options.workspaceRoot,
      threadId: options.threadId,
      gateway: options.gateway,
      model: options.model,
      signal: options.signal,
      compactHistoryFailures,
    });
    compactHistoryFailures = historyResult.failures;

    if (!historyResult.skipped && historyResult.summary) {
      payload = historyResult.payload;
      notes.push(
        historyResult.savedPath
          ? `L4 compact_history: archived to ${historyResult.savedPath} and replaced with summary.`
          : "L4 compact_history: replaced history with LLM summary.",
      );
      estimatedTokens = estimatePromptTokens(options.systemPrompt, payload);
    } else if (historyResult.reason) {
      notes.push(`L4 compact_history skipped: ${historyResult.reason}`);
    }
  }

  if (estimatedTokens > tokenThreshold) {
    const beforeSnip = payload.transcript.length + (payload.conversation?.length ?? 0);
    payload = {
      ...payload,
      conversation: snipCompactConversation(payload.conversation),
      transcript: snipCompactTranscript(payload.transcript),
    };
    const afterSnip = payload.transcript.length + (payload.conversation?.length ?? 0);
    if (afterSnip < beforeSnip) {
      notes.push(
        `L1 snip_compact: ${beforeSnip - afterSnip} messages removed after summary was unavailable.`,
      );
      estimatedTokens = estimatePromptTokens(options.systemPrompt, payload);
    }
  }

  const contextChanged = notes.some((note) => !/^L4 compact_history skipped:/i.test(note));
  const progressMessage = contextChanged ? contextProgressMessage(notes) : undefined;
  if (progressMessage) options.onProgress?.(progressMessage);

  return { payload, notes, compactHistoryFailures, contextChanged };
}
