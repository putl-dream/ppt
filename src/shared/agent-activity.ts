import { z } from "zod";
import { agentTodoItemSchema, TODO_TRACE_ID, type AgentTodoItem } from "./agent-todo";

export const agentActivityItemSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("reasoning"),
    content: z.string(),
    streaming: z.boolean().optional(),
    modelStep: z.number().int().nonnegative().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("tool"),
    toolName: z.string(),
    label: z.string(),
    finishedLabel: z.string().optional(),
    summary: z.string().optional(),
    status: z.enum(["running", "done"]),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("tool-summary"),
    toolName: z.string(),
    content: z.string(),
    streaming: z.boolean().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("step"),
    text: z.string(),
    status: z.enum(["typing", "running", "done"]).optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("todo"),
    todos: z.array(agentTodoItemSchema),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("tool-approval"),
    approvalId: z.string(),
    toolName: z.string(),
    reason: z.string(),
    detail: z.string(),
    status: z.enum(["pending", "approved", "denied"]),
  }),
]);

export type AgentActivityItem = z.infer<typeof agentActivityItemSchema>;

export function sealAllReasoning(trace: AgentActivityItem[]): AgentActivityItem[] {
  return trace.map((item) =>
    item.kind === "reasoning" && item.streaming
      ? { ...item, streaming: false }
      : item,
  );
}

export function finalizeReasoning(trace: AgentActivityItem[]): AgentActivityItem[] {
  const last = trace.at(-1);
  if (last?.kind === "reasoning" && last.streaming) {
    return [...trace.slice(0, -1), { ...last, streaming: false }];
  }
  return trace;
}

export function appendReasoningChunk(
  trace: AgentActivityItem[],
  chunk: string,
  modelStep = 0,
): AgentActivityItem[] {
  const last = trace.at(-1);
  if (
    last?.kind === "reasoning" &&
    last.streaming &&
    (last.modelStep ?? 0) === modelStep
  ) {
    return [...trace.slice(0, -1), { ...last, content: last.content + chunk }];
  }
  return [
    ...sealAllReasoning(trace),
    {
      id: crypto.randomUUID(),
      kind: "reasoning",
      content: chunk,
      streaming: true,
      modelStep,
    },
  ];
}

export function appendStep(
  trace: AgentActivityItem[],
  text: string,
  status: "typing" | "running" | "done" = "done",
): AgentActivityItem[] {
  return [
    ...finalizeReasoning(trace),
    {
      id: crypto.randomUUID(),
      kind: "step",
      text,
      status,
    },
  ];
}

export function upsertTodoTrace(
  trace: AgentActivityItem[],
  todos: AgentTodoItem[],
): AgentActivityItem[] {
  const sealed = finalizeReasoning(trace);
  const existingIndex = sealed.findIndex((item) => item.kind === "todo");
  const nextItem = {
    id: existingIndex >= 0 ? sealed[existingIndex]!.id : TODO_TRACE_ID,
    kind: "todo" as const,
    todos: todos.map((item) => ({ ...item })),
  };

  if (existingIndex >= 0) {
    return sealed.map((item, index) => (index === existingIndex ? nextItem : item));
  }

  return [...sealed, nextItem];
}

export function updateStepText(
  trace: AgentActivityItem[],
  stepId: string,
  text: string,
): AgentActivityItem[] {
  return trace.map((item) =>
    item.id === stepId && item.kind === "step"
      ? { ...item, text }
      : item,
  );
}

export function collectToolSummary(
  trace: AgentActivityItem[],
  toolName: string,
): { trace: AgentActivityItem[]; summary: string } {
  const summary = trace
    .filter((item): item is Extract<AgentActivityItem, { kind: "tool-summary" }> =>
      item.kind === "tool-summary" && item.toolName === toolName)
    .map((item) => item.content)
    .join("");
  const cleaned = trace.filter((item) => item.kind !== "tool-summary" || item.toolName !== toolName);
  return { trace: cleaned, summary };
}

export function appendToolSummaryChunk(
  trace: AgentActivityItem[],
  chunk: string,
  toolName = "SubmitCommands",
): AgentActivityItem[] {
  const sealed = sealAllReasoning(trace);
  const last = sealed.at(-1);
  if (
    last?.kind === "tool-summary" &&
    last.toolName === toolName &&
    last.streaming
  ) {
    return [...sealed.slice(0, -1), { ...last, content: last.content + chunk }];
  }
  return [
    ...sealed,
    {
      id: crypto.randomUUID(),
      kind: "tool-summary",
      toolName,
      content: chunk,
      streaming: true,
    },
  ];
}

export function appendToolValidationFailed(
  trace: AgentActivityItem[],
  toolName: string,
  errorMessage: string,
): AgentActivityItem[] {
  const { trace: cleaned, summary } = collectToolSummary(trace, toolName);
  const shortError = errorMessage.length > 160
    ? `${errorMessage.slice(0, 157)}...`
    : errorMessage;

  return [
    ...finalizeReasoning(cleaned),
    {
      id: crypto.randomUUID(),
      kind: "tool",
      toolName,
      label: `🛠️ 尝试调用: ${toolName}`,
      summary: summary || undefined,
      finishedLabel: `❌ 参数校验失败：${shortError}`,
      status: "done",
    },
  ];
}

export function appendToolStart(
  trace: AgentActivityItem[],
  toolName: string,
  label: string,
): AgentActivityItem[] {
  const { trace: cleaned, summary } = collectToolSummary(trace, toolName);
  return [
    ...finalizeReasoning(cleaned),
    {
      id: crypto.randomUUID(),
      kind: "tool",
      toolName,
      label,
      summary: summary || undefined,
      status: "running",
    },
  ];
}

export function appendToolApprovalWaiting(
  trace: AgentActivityItem[],
  input: {
    approvalId: string;
    toolName: string;
    reason: string;
    detail: string;
  },
): AgentActivityItem[] {
  return [
    ...finalizeReasoning(trace),
    {
      id: crypto.randomUUID(),
      kind: "tool-approval",
      approvalId: input.approvalId,
      toolName: input.toolName,
      reason: input.reason,
      detail: input.detail,
      status: "pending",
    },
  ];
}

export function resolveToolApprovalItem(
  trace: AgentActivityItem[],
  approvalId: string,
  status: "approved" | "denied",
): AgentActivityItem[] {
  return trace.map((item) =>
    item.kind === "tool-approval" && item.approvalId === approvalId
      ? { ...item, status }
      : item,
  );
}

export function finishTool(
  trace: AgentActivityItem[],
  toolName: string,
  finishedLabel: string,
): AgentActivityItem[] {
  let matchedIndex = -1;
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const item = trace[index];
    if (
      item.kind === "tool" &&
      item.toolName === toolName &&
      (item.status === "running" || !item.finishedLabel)
    ) {
      matchedIndex = index;
      break;
    }
  }

  if (matchedIndex === -1) {
    return appendStep(trace, finishedLabel, "done");
  }

  return trace.map((item, index) =>
    index === matchedIndex && item.kind === "tool"
      ? {
          ...item,
          status: "done" as const,
          finishedLabel,
        }
      : item,
  );
}

export function markTraceComplete(trace: AgentActivityItem[]): AgentActivityItem[] {
  return trace.map((item) => {
    if (item.kind === "reasoning") {
      return { ...item, streaming: false };
    }
    if (item.kind === "tool" && item.status === "running") {
      return { ...item, status: "done" as const };
    }
    if (item.kind === "step" && item.status && item.status !== "done") {
      return { ...item, status: "done" as const };
    }
    if (item.kind === "tool-summary" && item.streaming) {
      return { ...item, streaming: false };
    }
    return item;
  });
}

/** 合并多份时间线快照，取条目最多的一份（并列时取后者） */
export function mergeActivityTraces(
  ...traces: Array<AgentActivityItem[] | undefined>
): AgentActivityItem[] | undefined {
  const valid = traces.filter((trace): trace is AgentActivityItem[] => Boolean(trace?.length));
  if (valid.length === 0) return undefined;
  return valid.reduce((best, trace) => (trace.length >= best.length ? trace : best));
}

/** @deprecated 使用 mergeActivityTraces */
export function preferActivityTrace(
  existing: AgentActivityItem[] | undefined,
  incoming: AgentActivityItem[] | undefined,
): AgentActivityItem[] | undefined {
  return mergeActivityTraces(existing, incoming);
}

export function resolveActivityTrace(input: {
  activityTrace?: AgentActivityItem[];
  thought?: string[];
  reasoning?: string;
}): AgentActivityItem[] {
  if (input.activityTrace && input.activityTrace.length > 0) {
    return markTraceComplete(input.activityTrace).filter((item) => item.kind !== "tool-summary");
  }

  const legacy: AgentActivityItem[] = [];
  if (input.reasoning?.trim()) {
    legacy.push({
      id: "legacy-reasoning",
      kind: "reasoning",
      content: input.reasoning.trim(),
      streaming: false,
    });
  }
  if (input.thought?.length) {
    for (const [index, text] of input.thought.entries()) {
      legacy.push({
        id: `legacy-step-${index}`,
        kind: "step",
        text,
        status: "done",
      });
    }
  }
  return legacy;
}
