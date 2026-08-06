import { z } from "zod";

export const agentTaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export const agentTaskExecutionTargetSchema = z.enum(["lead", "teammate"]);
export const taskCompletionPolicySchema = z.enum(["direct", "review_required"]);

const reviewBaseSchema = z.object({
  requestId: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedAt: z.string().datetime(),
});

export const taskReviewSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  reviewBaseSchema.extend({ state: z.literal("requested") }),
  reviewBaseSchema.extend({
    state: z.literal("changes_requested"),
    reviewedBy: z.string().min(1),
    reviewedAt: z.string().datetime(),
    reason: z.string().optional(),
  }),
  reviewBaseSchema.extend({
    state: z.literal("approved"),
    reviewedBy: z.string().min(1),
    reviewedAt: z.string().datetime(),
  }),
]);

export const taskReviewReceiptSchema = z.object({
  command: z.enum(["request", "approve", "reject"]),
  requestId: z.string().min(1),
  result: taskReviewSchema,
});

export const agentTaskNodeSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  subject: z.string().min(1),
  description: z.string(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  status: agentTaskStatusSchema,
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  routing: z.object({ executionTarget: agentTaskExecutionTargetSchema }),
  completionPolicy: taskCompletionPolicySchema,
  review: taskReviewSchema,
  reviewReceipts: z.array(taskReviewReceiptSchema).default([]),
  userMetadata: z.record(z.string(), z.unknown()).optional(),
  systemMetadata: z.record(z.string(), z.unknown()).optional(),
});

export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;
export type AgentTaskExecutionTarget = z.infer<typeof agentTaskExecutionTargetSchema>;
export type TaskCompletionPolicy = z.infer<typeof taskCompletionPolicySchema>;
export type TaskReview = z.infer<typeof taskReviewSchema>;
export type AgentTaskNode = z.infer<typeof agentTaskNodeSchema>;

export const TASKS_DIR_NAME = ".tasks";
export const TASK_LIST_TRACE_ID = "agent-task-list";

export function getIncompleteBlockedBy(
  task: AgentTaskNode,
  tasksById: Map<string, AgentTaskNode>,
): string[] {
  return task.blockedBy.filter((id) => tasksById.get(id)?.status !== "completed");
}

export function canStartTask(task: AgentTaskNode, tasksById: Map<string, AgentTaskNode>): boolean {
  return getIncompleteBlockedBy(task, tasksById).length === 0;
}

export function hasDependencyCycle(tasks: AgentTaskNode[]): boolean {
  const edges = new Map(tasks.map((task) => [task.id, task.blockedBy]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) {
      if (edges.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...edges.keys()].some(visit);
}

export function summarizeTaskNode(task: AgentTaskNode): string {
  const owner = task.owner ? ` · owner: ${task.owner}` : "";
  const blocked = task.blockedBy.length ? ` · blockedBy: ${task.blockedBy.join(", ")}` : "";
  return `[${task.status}] ${task.id}: ${task.subject} · target: ${task.routing.executionTarget}${owner}${blocked}`;
}

export function formatTaskListSummary(tasks: AgentTaskNode[]): string {
  if (tasks.length === 0) return "暂无持久化任务";
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks
    .map((task) => {
      const blockers = getIncompleteBlockedBy(task, byId);
      return (
        `#${task.id} [${task.status}] ${task.subject}` +
        (task.owner ? ` (${task.owner})` : "") +
        (blockers.length ? ` [blocked by ${blockers.join(", ")}]` : "")
      );
    })
    .join("\n");
}

export function formatTaskOwnerForDisplay(
  task: Pick<AgentTaskNode, "owner" | "routing">,
): string | null {
  if (!task.owner) return null;
  return task.routing.executionTarget === "teammate" ? "协作助手" : "主助手";
}

export function summarizeTaskListProgress(tasks: AgentTaskNode[]): string {
  if (!tasks.length) return "暂无任务";
  const completed = tasks.filter((task) => task.status === "completed").length;
  const current = tasks.find((task) => task.status === "in_progress");
  const reviews = tasks.filter((task) => task.review.state === "requested").length;
  return [
    `${completed}/${tasks.length} 已完成`,
    current ? `进行中: ${current.subject}` : undefined,
    reviews ? `${reviews} 项待验收` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatTaskPlanPosition(tasks: AgentTaskNode[]): string {
  const reviewIndex = tasks.findIndex((task) => task.review.state === "requested");
  if (reviewIndex >= 0) {
    const task = tasks[reviewIndex]!;
    return `待验收 ${reviewIndex + 1}/${tasks.length} · ${formatTaskPositionLabel(task)}`;
  }
  const currentIndex = tasks.findIndex((task) => task.status === "in_progress");
  if (currentIndex >= 0) {
    const task = tasks[currentIndex]!;
    return `步骤 ${currentIndex + 1}/${tasks.length} · ${formatTaskPositionLabel(task)}`;
  }
  const completed = tasks.filter((task) => task.status === "completed").length;
  return completed === tasks.length && tasks.length
    ? `全部完成 · ${completed}/${tasks.length}`
    : summarizeTaskListProgress(tasks);
}

function formatTaskPositionLabel(task: AgentTaskNode): string {
  const owner = formatTaskOwnerForDisplay(task);
  return owner ? `${task.subject} · ${owner}` : task.subject;
}

export function isTaskPlanActive(tasks: AgentTaskNode[]): boolean {
  return tasks.some((task) => task.status !== "completed");
}
