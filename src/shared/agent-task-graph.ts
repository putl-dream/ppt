import { z } from "zod";

export const agentTaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;

export const agentTaskNodeSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  description: z.string(),
  status: agentTaskStatusSchema,
  owner: z.string().nullable(),
  blockedBy: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentTaskNode = z.infer<typeof agentTaskNodeSchema>;

export const TASKS_DIR_NAME = ".tasks";

export function summarizeTaskNode(task: AgentTaskNode): string {
  const blocked =
    task.blockedBy.length > 0 ? ` · blockedBy: ${task.blockedBy.join(", ")}` : "";
  const owner = task.owner ? ` · owner: ${task.owner}` : "";
  return `[${task.status}] ${task.id}: ${task.subject}${owner}${blocked}`;
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
