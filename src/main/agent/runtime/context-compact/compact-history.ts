import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentModelGateway } from "../../gateway/types";
import type { AgentModelSelection } from "@shared/agent";
import type { ModelPromptPayload } from "../model-call-recovery";
import { COMPACT_HISTORY_MAX_FAILURES, COMPACT_TRANSCRIPTS_DIR } from "./config";
import type { TranscriptEntry } from "./types";
import { callLLM } from "../../gateway/model-calls";

const SUMMARY_SYSTEM_PROMPT = `You compress agent conversation history for context window management.
Return a concise markdown summary that preserves:
- Current goal and user constraints
- Important discoveries and decisions
- Files changed or read
- Remaining work and open questions
- Tool outcomes that still matter for the next steps
Do not invent facts. Use the same language as the conversation when possible.`;

export interface CompactHistoryOptions {
  payload: ModelPromptPayload;
  workspaceRoot?: string;
  threadId?: string;
  gateway: AgentModelGateway;
  model?: AgentModelSelection;
  signal?: AbortSignal;
  compactHistoryFailures?: number;
}

export interface CompactHistoryResult {
  payload: ModelPromptPayload;
  savedPath?: string;
  summary?: string;
  skipped: boolean;
  failures: number;
  reason?: string;
}

async function saveCompactionTranscript(
  workspaceRoot: string,
  threadId: string,
  payload: ModelPromptPayload,
): Promise<string> {
  const dir = join(workspaceRoot, COMPACT_TRANSCRIPTS_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${threadId}-${Date.now()}.jsonl`);

  const lines: TranscriptEntry[] = [
    ...(payload.conversation ?? []).map((message) => ({
      role: message.role,
      kind: "message",
      content: message.content,
    })),
    ...payload.transcript,
  ];

  for (const line of lines) {
    await appendFile(filePath, `${JSON.stringify(line)}\n`, "utf8");
  }

  return filePath;
}

async function requestHistorySummary(
  gateway: AgentModelGateway,
  payload: ModelPromptPayload,
  model: AgentModelSelection | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  return callLLM(
    gateway,
    {
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      responseContract: "markdown-summary",
      prompt: JSON.stringify({
        instruction: "Summarize this agent session history for continuation.",
        request: payload.request ?? payload.task,
        conversation: payload.conversation ?? [],
        transcript: payload.transcript,
      }),
      signal,
      maxOutputTokens: 4_096,
    },
    model,
  );
}

function buildCompactedPayload(
  payload: ModelPromptPayload,
  summary: string,
  savedPath: string,
): ModelPromptPayload {
  const recentTail = payload.transcript.slice(-3);
  return {
    ...payload,
    conversation: [],
    transcript: [
      {
        role: "system",
        kind: "compact_boundary",
        content: summary,
        savedTranscript: savedPath,
      },
      ...recentTail,
    ],
  };
}

/**
 * L4: compact_history — archive full history, LLM summary, replace active context.
 * Circuit breaker stops after COMPACT_HISTORY_MAX_FAILURES consecutive failures.
 */
export async function compactHistory(
  options: CompactHistoryOptions,
): Promise<CompactHistoryResult> {
  const failures = options.compactHistoryFailures ?? 0;
  if (failures >= COMPACT_HISTORY_MAX_FAILURES) {
    return {
      payload: options.payload,
      skipped: true,
      failures,
      reason: "compact_history circuit breaker open",
    };
  }

  if (!options.workspaceRoot || !options.threadId) {
    return {
      payload: options.payload,
      skipped: true,
      failures,
      reason: "workspaceRoot or threadId missing",
    };
  }

  try {
    const savedPath = await saveCompactionTranscript(
      options.workspaceRoot,
      options.threadId,
      options.payload,
    );
    const summary = await requestHistorySummary(
      options.gateway,
      options.payload,
      options.model,
      options.signal,
    );
    return {
      payload: buildCompactedPayload(options.payload, summary, savedPath),
      savedPath,
      summary,
      skipped: false,
      failures: 0,
    };
  } catch (error) {
    const nextFailures = failures + 1;
    return {
      payload: options.payload,
      skipped: true,
      failures: nextFailures,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
