import type { AgentActivityItem } from "@shared/agent-activity";

export type AgentRunTimelineSegment =
  | { kind: "response"; item: Extract<AgentActivityItem, { kind: "response" }> }
  | { kind: "task"; item: Extract<AgentActivityItem, { kind: "task" }> }
  | { kind: "thought"; item: Extract<AgentActivityItem, { kind: "reasoning" }> }
  | { kind: "tool_batch"; items: AgentActivityItem[] };

function isToolBatchItem(item: AgentActivityItem): boolean {
  return item.kind === "tool" || item.kind === "tool-approval" || item.kind === "step";
}

function flushToolBatch(segments: AgentRunTimelineSegment[], batch: AgentActivityItem[]): void {
  if (batch.length === 0) return;
  segments.push({ kind: "tool_batch", items: [...batch] });
  batch.length = 0;
}

/** Split activity items into Cursor-style timeline segments (order preserved). */
export function buildAgentRunTimelineSegments(
  items: AgentActivityItem[],
): AgentRunTimelineSegment[] {
  const segments: AgentRunTimelineSegment[] = [];
  const toolBatch: AgentActivityItem[] = [];

  for (const item of items) {
    if (item.kind === "tasklist") continue;

    if (item.kind === "response") {
      flushToolBatch(segments, toolBatch);
      segments.push({ kind: "response", item });
      continue;
    }

    if (item.kind === "task") {
      flushToolBatch(segments, toolBatch);
      segments.push({ kind: "task", item });
      continue;
    }

    if (item.kind === "reasoning") {
      flushToolBatch(segments, toolBatch);
      segments.push({ kind: "thought", item });
      continue;
    }

    if (isToolBatchItem(item)) {
      toolBatch.push(item);
    }
  }

  flushToolBatch(segments, toolBatch);
  return segments;
}

export function toolBatchHasRunning(items: AgentActivityItem[]): boolean {
  return items.some((item) => item.kind === "tool" && item.status === "running");
}

export function toolBatchAllTerminal(items: AgentActivityItem[]): boolean {
  const tools = items.filter(
    (item): item is Extract<AgentActivityItem, { kind: "tool" }> => item.kind === "tool",
  );
  if (tools.length === 0) return true;
  return tools.every((item) => item.status !== "running");
}

/** Whether this tool_batch should auto-collapse when not user-pinned. */
export function shouldAutoCollapseToolBatch(input: {
  items: AgentActivityItem[];
  runLive: boolean;
  hasLaterResponse: boolean;
}): boolean {
  if (toolBatchHasRunning(input.items)) return false;
  if (!toolBatchAllTerminal(input.items)) return false;
  return input.hasLaterResponse || !input.runLive;
}

/** Whether this tool_batch is still an active working process. */
export function isToolBatchActive(input: {
  items: AgentActivityItem[];
  runLive: boolean;
  hasLaterResponse: boolean;
}): boolean {
  if (toolBatchHasRunning(input.items)) return true;
  if (!input.runLive) return false;
  return !input.hasLaterResponse;
}
