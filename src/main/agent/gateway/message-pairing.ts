import type {
  AgentModelMessage,
  AgentModelToolCall,
  AgentModelToolResult,
} from "./types";

const MISSING_RESULT_PREFIX = "Tool execution did not produce a result";

function cloneMessage(message: AgentModelMessage): AgentModelMessage {
  return {
    ...message,
    images: message.images ? [...message.images] : undefined,
    thinkingBlocks: message.thinkingBlocks ? [...message.thinkingBlocks] : undefined,
    toolCalls: message.toolCalls ? [...message.toolCalls] : undefined,
    toolResults: message.toolResults ? [...message.toolResults] : undefined,
  };
}

function dedupeToolCalls(calls: AgentModelToolCall[] | undefined): AgentModelToolCall[] {
  const seen = new Set<string>();
  const deduped: AgentModelToolCall[] = [];
  for (const call of calls ?? []) {
    if (!call.id || seen.has(call.id)) continue;
    seen.add(call.id);
    deduped.push(call);
  }
  return deduped;
}

function pairResults(
  calls: AgentModelToolCall[],
  results: AgentModelToolResult[] | undefined,
): AgentModelToolResult[] {
  const expected = new Set(calls.map((call) => call.id));
  const byCallId = new Map<string, AgentModelToolResult>();

  for (const result of results ?? []) {
    if (!expected.has(result.toolCallId) || byCallId.has(result.toolCallId)) continue;
    byCallId.set(result.toolCallId, result);
  }

  return calls.map((call) => byCallId.get(call.id) ?? ({
    toolCallId: call.id,
    content: `${MISSING_RESULT_PREFIX} for ${call.name}.`,
    isError: true,
  }));
}

function hasPayload(message: AgentModelMessage): boolean {
  return Boolean(
    message.content?.trim()
      || message.images?.length
      || message.thinkingBlocks?.length
      || message.toolCalls?.length
      || message.toolResults?.length,
  );
}

/**
 * Repair provider-neutral message history immediately before an API request.
 *
 * Invariants:
 * - every assistant tool call has exactly one following tool result;
 * - duplicate tool call/result IDs are reduced to their first occurrence;
 * - orphan tool results are removed;
 * - missing results become synthetic error results so one failed tool cannot
 *   corrupt the whole provider conversation.
 */
export function ensureToolResultPairing(
  messages: AgentModelMessage[],
): AgentModelMessage[] {
  const repaired: AgentModelMessage[] = [];
  let pendingCalls: AgentModelToolCall[] = [];

  const flushMissingResults = (): void => {
    if (pendingCalls.length === 0) return;
    repaired.push({
      role: "user",
      toolResults: pairResults(pendingCalls, undefined),
    });
    pendingCalls = [];
  };

  for (const source of messages) {
    const message = cloneMessage(source);

    if (message.role === "assistant") {
      flushMissingResults();
      const calls = dedupeToolCalls(message.toolCalls);
      message.toolCalls = calls.length ? calls : undefined;
      if (hasPayload(message)) repaired.push(message);
      pendingCalls = calls;
      continue;
    }

    if (pendingCalls.length > 0) {
      message.toolResults = pairResults(pendingCalls, message.toolResults);
      pendingCalls = [];
    } else {
      // Provider APIs reject tool results that do not reference a preceding call.
      message.toolResults = undefined;
    }

    if (hasPayload(message)) repaired.push(message);
  }

  flushMissingResults();
  return repaired;
}
