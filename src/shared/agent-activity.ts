import { z } from "zod";
import { agentTaskNodeSchema, TASK_GRAPH_TRACE_ID, type AgentTaskNode } from "./agent-task-graph";

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
    kind: z.literal("taskgraph"),
    tasks: z.array(agentTaskNodeSchema),
    goal: z.string().nullable().optional(),
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
  z.object({
    id: z.string(),
    kind: z.literal("task"),
    taskId: z.string(),
    description: z.string(),
    status: z.enum(["running", "done"]),
    steps: z.array(z.object({
      id: z.string(),
      type: z.enum(["reasoning", "tool"]),
      text: z.string(),
      toolName: z.string().optional(),
      status: z.enum(["running", "done"]),
      streaming: z.boolean().optional(),
    })),
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

export function upsertTaskGraphTrace(
  trace: AgentActivityItem[],
  input: { tasks: AgentTaskNode[]; goal?: string | null },
): AgentActivityItem[] {
  const sealed = finalizeReasoning(trace);
  const existingIndex = sealed.findIndex((item) => item.kind === "taskgraph");
  const nextItem = {
    id: existingIndex >= 0 ? sealed[existingIndex]!.id : TASK_GRAPH_TRACE_ID,
    kind: "taskgraph" as const,
    tasks: input.tasks.map((task) => ({ ...task })),
    goal: input.goal ?? null,
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

export function findPendingToolApproval(
  trace: AgentActivityItem[],
): Extract<AgentActivityItem, { kind: "tool-approval" }> | undefined {
  return [...trace].reverse().find(
    (item): item is Extract<AgentActivityItem, { kind: "tool-approval" }> =>
      item.kind === "tool-approval" && item.status === "pending",
  );
}

export function filterTraceForDisplay(trace: AgentActivityItem[]): AgentActivityItem[] {
  return trace.filter(
    (item) =>
      item.kind !== "taskgraph" &&
      !(item.kind === "tool-approval" && item.status === "pending"),
  );
}

export function extractLatestTaskGraph(
  ...traces: Array<AgentActivityItem[] | undefined>
): { tasks: AgentTaskNode[]; goal?: string | null } | null {
  for (const trace of traces) {
    if (!trace?.length) continue;
    for (let index = trace.length - 1; index >= 0; index -= 1) {
      const item = trace[index];
      if (item?.kind === "taskgraph" && item.tasks.length > 0) {
        return { tasks: item.tasks, goal: item.goal ?? null };
      }
    }
  }
  return null;
}

type TaskStep = Extract<AgentActivityItem, { kind: "task" }>["steps"][number];

function upsertTask(
  trace: AgentActivityItem[],
  taskId: string,
  updater: (task: Extract<AgentActivityItem, { kind: "task" }>) => Extract<AgentActivityItem, { kind: "task" }>,
): AgentActivityItem[] {
  const index = trace.findIndex((item) => item.kind === "task" && item.taskId === taskId);
  if (index < 0) return trace;
  return trace.map((item, i) => (i === index ? updater(item as Extract<AgentActivityItem, { kind: "task" }>) : item));
}

export function upsertTaskStarted(
  trace: AgentActivityItem[],
  input: { taskId: string; description: string },
): AgentActivityItem[] {
  const existing = trace.find((item) => item.kind === "task" && item.taskId === input.taskId);
  if (existing?.kind === "task") {
    return upsertTask(trace, input.taskId, (task) => ({
      ...task,
      description: input.description,
      status: "running",
    }));
  }
  return [
    ...finalizeReasoning(trace),
    {
      id: crypto.randomUUID(),
      kind: "task",
      taskId: input.taskId,
      description: input.description,
      status: "running",
      steps: [],
    },
  ];
}

export function appendTaskReasoningChunk(
  trace: AgentActivityItem[],
  taskId: string,
  chunk: string,
): AgentActivityItem[] {
  return upsertTask(trace, taskId, (task) => {
    const steps = [...task.steps];
    const last = steps.at(-1);
    if (last?.type === "reasoning" && last.streaming) {
      steps[steps.length - 1] = { ...last, text: last.text + chunk };
    } else {
      steps.push({
        id: crypto.randomUUID(),
        type: "reasoning",
        text: chunk,
        status: "running",
        streaming: true,
      });
    }
    return { ...task, steps };
  });
}

export function appendTaskToolStart(
  trace: AgentActivityItem[],
  taskId: string,
  toolName: string,
  message: string,
): AgentActivityItem[] {
  return upsertTask(trace, taskId, (task) => {
    const steps = task.steps.map((step): TaskStep =>
      step.streaming ? { ...step, streaming: false, status: "done" } : step,
    );
    steps.push({
      id: crypto.randomUUID(),
      type: "tool",
      text: message,
      toolName,
      status: "running",
    });
    return { ...task, steps };
  });
}

export function finishTaskTool(
  trace: AgentActivityItem[],
  taskId: string,
  toolName: string,
  message: string,
): AgentActivityItem[] {
  return upsertTask(trace, taskId, (task) => {
    let matched = false;
    const steps = [...task.steps];
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const step = steps[index]!;
      if (step.type === "tool" && step.toolName === toolName && step.status === "running") {
        steps[index] = { ...step, text: message, status: "done" };
        matched = true;
        break;
      }
    }
    if (!matched) {
      steps.push({
        id: crypto.randomUUID(),
        type: "tool",
        text: message,
        toolName,
        status: "done",
      });
    }
    return { ...task, steps };
  });
}

export function finishTask(
  trace: AgentActivityItem[],
  taskId: string,
): AgentActivityItem[] {
  return upsertTask(trace, taskId, (task) => ({
    ...task,
    status: "done",
    steps: task.steps.map((step): TaskStep =>
      step.streaming || step.status === "running"
        ? { ...step, streaming: false, status: "done" }
        : step,
    ),
  }));
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
    if (item.kind === "task" && item.status === "running") {
      return {
        ...item,
        status: "done" as const,
        steps: item.steps.map((step) =>
          step.streaming || step.status === "running"
            ? { ...step, streaming: false, status: "done" as const }
            : step,
        ),
      };
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
