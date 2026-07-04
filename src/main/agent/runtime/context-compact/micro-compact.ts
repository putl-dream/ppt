import { MICRO_COMPACT_KEEP_TOOL_RESULTS, MICRO_COMPACT_PLACEHOLDER } from "./config";
import type { TranscriptEntry } from "./types";

function isToolResultEntry(entry: TranscriptEntry): boolean {
  return entry.role === "tool"
    || entry.kind === "tool_result"
    || (entry.role === "user" && entry.kind === "tool_result");
}

function serializeResult(entry: TranscriptEntry): string {
  if (entry.result !== undefined) return JSON.stringify(entry.result);
  if (entry.error !== undefined) return String(entry.error);
  if (entry.content !== undefined) return String(entry.content);
  return "";
}

function compactToolEntry(entry: TranscriptEntry): TranscriptEntry {
  const toolName = typeof entry.toolName === "string" ? entry.toolName : "tool";
  const compacted: TranscriptEntry = {
    ...entry,
    compacted: true,
  };
  if (entry.result !== undefined) {
    compacted.result = MICRO_COMPACT_PLACEHOLDER(toolName);
  }
  if (entry.content !== undefined) {
    compacted.content = MICRO_COMPACT_PLACEHOLDER(toolName);
  }
  return compacted;
}

/**
 * L2: micro_compact — keep only the last N tool results at full size.
 */
export function microCompactTranscript(
  transcript: TranscriptEntry[],
  keepRecent = MICRO_COMPACT_KEEP_TOOL_RESULTS,
): TranscriptEntry[] {
  const toolIndices: number[] = [];
  for (let index = 0; index < transcript.length; index += 1) {
    if (isToolResultEntry(transcript[index])) {
      toolIndices.push(index);
    }
  }

  if (toolIndices.length <= keepRecent) return transcript;

  const keepSet = new Set(toolIndices.slice(-keepRecent));
  return transcript.map((entry, index) => {
    if (!toolIndices.includes(index)) return entry;
    if (keepSet.has(index)) return entry;
    if (entry.compacted) return entry;
    return compactToolEntry(entry);
  });
}

export function measureToolResultBytes(entry: TranscriptEntry): number {
  return new TextEncoder().encode(serializeResult(entry)).length;
}
