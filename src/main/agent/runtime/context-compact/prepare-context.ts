import type { ModelPromptPayload } from "../model-call-recovery";
import { resolveContextTokenThreshold } from "./config";
import { compactHistory } from "./compact-history";
import { estimatePromptTokens } from "./estimate-tokens";
import { microCompactTranscript } from "./micro-compact";
import { snipCompactConversation, snipCompactTranscript } from "./snip-compact";
import { toolResultBudget } from "./tool-result-budget";
import type { ContextCompactResult, PrepareContextOptions } from "./types";

export const CONTEXT_PREPARED_USER_MESSAGE = "已整理较早的会话记录，正在继续处理…";

/**
 * Run L1→L3 (0 API), then L4 LLM summary when still over token threshold.
 */
export async function prepareContext(
  options: PrepareContextOptions,
): Promise<ContextCompactResult> {
  const notes: string[] = [];
  let compactHistoryFailures = options.compactHistoryFailures ?? 0;

  let payload: ModelPromptPayload = structuredClone(options.payload);

  const beforeSnip = payload.transcript.length + (payload.conversation?.length ?? 0);
  payload = {
    ...payload,
    conversation: snipCompactConversation(payload.conversation),
    transcript: snipCompactTranscript(payload.transcript),
  };
  const afterSnip = payload.transcript.length + (payload.conversation?.length ?? 0);
  if (afterSnip < beforeSnip) {
    notes.push(`L1 snip_compact: ${beforeSnip - afterSnip} messages removed from middle.`);
  }

  const beforeMicro = JSON.stringify(payload.transcript).length;
  payload = {
    ...payload,
    transcript: microCompactTranscript(payload.transcript),
  };
  const afterMicro = JSON.stringify(payload.transcript).length;
  if (afterMicro < beforeMicro) {
    notes.push("L2 micro_compact: older tool results replaced with placeholders.");
  }

  const budgetResult = await toolResultBudget(payload.transcript, options.workspaceRoot);
  payload = { ...payload, transcript: budgetResult.transcript };
  notes.push(...budgetResult.notes);

  const tokenThreshold = options.tokenThreshold ?? resolveContextTokenThreshold();
  let estimatedTokens = estimatePromptTokens(options.systemPrompt, payload);

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

  // `notes` are diagnostics for logs/snapshots. The UI receives one stable,
  // user-facing status instead of internal L1/L2/L4 implementation details.
  const contextWasOptimized = notes.some((note) => !/^L4 compact_history skipped:/i.test(note));
  if (contextWasOptimized) options.onProgress?.(CONTEXT_PREPARED_USER_MESSAGE);

  return { payload, notes, compactHistoryFailures };
}
