import { z } from "zod";

export const agentActivityItemSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("reasoning"),
    content: z.string(),
    streaming: z.boolean().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("tool"),
    toolName: z.string(),
    label: z.string(),
    finishedLabel: z.string().optional(),
    status: z.enum(["running", "done"]),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("step"),
    text: z.string(),
    status: z.enum(["typing", "running", "done"]).optional(),
  }),
]);

export type AgentActivityItem = z.infer<typeof agentActivityItemSchema>;

export function finalizeReasoning(trace: AgentActivityItem[]): AgentActivityItem[] {
  const last = trace.at(-1);
  if (last?.kind === "reasoning" && last.streaming) {
    return [...trace.slice(0, -1), { ...last, streaming: false }];
  }
  return trace;
}

export function appendReasoningChunk(trace: AgentActivityItem[], chunk: string): AgentActivityItem[] {
  const last = trace.at(-1);
  if (last?.kind === "reasoning" && last.streaming) {
    return [...trace.slice(0, -1), { ...last, content: last.content + chunk }];
  }
  return [
    ...finalizeReasoning(trace),
    {
      id: crypto.randomUUID(),
      kind: "reasoning",
      content: chunk,
      streaming: true,
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

export function appendToolStart(
  trace: AgentActivityItem[],
  toolName: string,
  label: string,
): AgentActivityItem[] {
  return [
    ...finalizeReasoning(trace),
    {
      id: crypto.randomUUID(),
      kind: "tool",
      toolName,
      label,
      status: "running",
    },
  ];
}

export function finishTool(
  trace: AgentActivityItem[],
  toolName: string,
  finishedLabel: string,
): AgentActivityItem[] {
  let matched = false;
  const updated = trace.map((item) => {
    if (
      !matched &&
      item.kind === "tool" &&
      item.toolName === toolName &&
      item.status === "running"
    ) {
      matched = true;
      return {
        ...item,
        status: "done" as const,
        finishedLabel,
      };
    }
    return item;
  });
  if (!matched) {
    return appendStep(updated, finishedLabel, "done");
  }
  return updated;
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
    return item;
  });
}

export function resolveActivityTrace(input: {
  activityTrace?: AgentActivityItem[];
  thought?: string[];
  reasoning?: string;
}): AgentActivityItem[] {
  if (input.activityTrace && input.activityTrace.length > 0) {
    return markTraceComplete(input.activityTrace);
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
