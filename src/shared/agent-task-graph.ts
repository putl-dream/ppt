import { z } from "zod";

export const agentTaskStatusSchema = z.enum(["pending", "in_progress", "submitted", "completed"]);

export const agentTaskExecutionTargetSchema = z.enum(["lead", "teammate"]);

export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;
export type AgentTaskExecutionTarget = z.infer<typeof agentTaskExecutionTargetSchema>;

export const agentTaskNodeSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  description: z.string(),
  status: agentTaskStatusSchema,
  /** Missing on legacy task files; treat as lead at scheduling boundaries. */
  executionTarget: agentTaskExecutionTargetSchema.optional(),
  owner: z.string().nullable(),
  /** Process incarnation that owns an in-progress claim. */
  claimInstanceId: z.string().optional(),
  blockedBy: z.array(z.string()),
  planId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentTaskNode = z.infer<typeof agentTaskNodeSchema>;

export const TASKS_DIR_NAME = ".tasks";

export function summarizeTaskNode(task: AgentTaskNode): string {
  const blocked =
    task.blockedBy.length > 0 ? ` · blockedBy: ${task.blockedBy.join(", ")}` : "";
  const owner = task.owner ? ` · owner: ${task.owner}` : "";
  const target = ` · target: ${task.executionTarget ?? "lead"}`;
  return `[${task.status}] ${task.id}: ${task.subject}${target}${owner}${blocked}`;
}

export function formatTaskListSummary(tasks: AgentTaskNode[]): string {
  if (tasks.length === 0) return "暂无持久化任务";
  return tasks.map(summarizeTaskNode).join("\n");
}

export function canStartTask(task: AgentTaskNode, tasksById: Map<string, AgentTaskNode>): boolean {
  for (const depId of task.blockedBy) {
    const dep = tasksById.get(depId);
    if (!dep || dep.status !== "completed") {
      return false;
    }
  }
  return true;
}

export function findUnblockedPendingTasks(tasks: AgentTaskNode[]): AgentTaskNode[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter(
    (task) => task.status === "pending" && task.blockedBy.length > 0 && canStartTask(task, tasksById),
  );
}

/** Returns true when blockedBy edges form a cycle. */
export function hasDependencyCycle(tasks: AgentTaskNode[]): boolean {
  const blockedByMap = new Map(tasks.map((task) => [task.id, task.blockedBy]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const depId of blockedByMap.get(id) ?? []) {
      if (!blockedByMap.has(depId)) continue;
      if (dfs(depId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of blockedByMap.keys()) {
    if (!visited.has(id) && dfs(id)) return true;
  }
  return false;
}

export function getIncompleteBlockedBy(
  task: AgentTaskNode,
  tasksById: Map<string, AgentTaskNode>,
): string[] {
  return task.blockedBy.filter((depId) => {
    const dep = tasksById.get(depId);
    return !dep || dep.status !== "completed";
  });
}

export const TASK_GRAPH_TRACE_ID = "agent-task-graph";

export function formatTaskOwnerForDisplay(
  task: Pick<AgentTaskNode, "owner" | "executionTarget">,
): string | null {
  if (!task.owner) return null;
  if (task.executionTarget === "teammate") return "协作助手";
  return "主助手";
}

export function summarizeTaskGraphProgress(tasks: AgentTaskNode[]): string {
  if (tasks.length === 0) return "暂无任务";
  const completed = tasks.filter((task) => task.status === "completed").length;
  const inProgress = tasks.find((task) => task.status === "in_progress");
  const submitted = tasks.filter((task) => task.status === "submitted").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const parts = [`${completed}/${tasks.length} 已完成`];
  if (inProgress) parts.push(`进行中: ${inProgress.subject}`);
  if (submitted > 0) parts.push(`${submitted} 项待验收`);
  else if (pending > 0) parts.push(`${pending} 项待认领`);
  return parts.join(" · ");
}

/** 折叠态摘要：突出当前执行步骤位置 */
export function formatTaskPlanPosition(tasks: AgentTaskNode[]): string {
  if (tasks.length === 0) return "暂无任务";
  const inProgressIndex = tasks.findIndex((task) => task.status === "in_progress");
  if (inProgressIndex >= 0) {
    const current = tasks[inProgressIndex]!;
    const displayOwner = formatTaskOwnerForDisplay(current);
    const owner = displayOwner ? ` · ${displayOwner}` : "";
    return `步骤 ${inProgressIndex + 1}/${tasks.length} · ${current.subject}${owner}`;
  }
  const submittedIndex = tasks.findIndex((task) => task.status === "submitted");
  if (submittedIndex >= 0) {
    const current = tasks[submittedIndex]!;
    const displayOwner = formatTaskOwnerForDisplay(current);
    const owner = displayOwner ? ` · ${displayOwner}` : "";
    return `待验收 ${submittedIndex + 1}/${tasks.length} · ${current.subject}${owner}`;
  }
  const completed = tasks.filter((task) => task.status === "completed").length;
  if (completed === tasks.length) {
    return `全部完成 · ${completed}/${tasks.length}`;
  }
  return summarizeTaskGraphProgress(tasks);
}

/** 计划是否仍在执行中（仍有未完成或进行中步骤） */
export function isTaskPlanActive(tasks: AgentTaskNode[]): boolean {
  if (tasks.length === 0) return false;
  return tasks.some((task) =>
    task.status === "pending" || task.status === "in_progress" || task.status === "submitted"
  );
}

/** 按 planId 过滤；无 planId 时返回全部任务 */
export function filterTasksByPlan(tasks: AgentTaskNode[], planId?: string): AgentTaskNode[] {
  if (!planId) return tasks;
  return tasks.filter((task) => task.planId === planId);
}
