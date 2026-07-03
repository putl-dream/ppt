import { z } from "zod";

export const agentTodoStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export type AgentTodoStatus = z.infer<typeof agentTodoStatusSchema>;

export const agentTodoItemSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  status: agentTodoStatusSchema,
});

export type AgentTodoItem = z.infer<typeof agentTodoItemSchema>;

export const TODO_WRITE_REMINDER_THRESHOLD = 3;

export const TODO_TRACE_ID = "agent-todo-list";

export function applyTodoUpdate(
  current: AgentTodoItem[],
  merge: boolean,
  incoming: AgentTodoItem[],
): AgentTodoItem[] {
  if (!merge) {
    return incoming.map((item) => ({ ...item }));
  }

  const byId = new Map(current.map((item) => [item.id, { ...item }]));
  for (const item of incoming) {
    byId.set(item.id, { ...item });
  }
  return Array.from(byId.values());
}

export function summarizeTodoProgress(items: AgentTodoItem[]): string {
  if (items.length === 0) return "暂无任务";
  const completed = items.filter((item) => item.status === "completed").length;
  const inProgress = items.find((item) => item.status === "in_progress");
  const pending = items.filter((item) => item.status === "pending").length;
  const parts = [`${completed}/${items.length} 已完成`];
  if (inProgress) parts.push(`进行中: ${inProgress.content}`);
  else if (pending > 0) parts.push(`${pending} 项待办`);
  return parts.join(" · ");
}

/** 折叠态摘要：突出当前执行步骤位置 */
export function formatTodoPosition(items: AgentTodoItem[]): string {
  if (items.length === 0) return "暂无任务";
  const inProgressIndex = items.findIndex((item) => item.status === "in_progress");
  if (inProgressIndex >= 0) {
    const current = items[inProgressIndex]!;
    return `步骤 ${inProgressIndex + 1}/${items.length} · ${current.content}`;
  }
  const completed = items.filter((item) => item.status === "completed").length;
  if (completed === items.length) {
    return `全部完成 · ${completed}/${items.length}`;
  }
  return summarizeTodoProgress(items);
}

/** 计划是否仍在执行中（有待办或进行中步骤） */
export function isTodoPlanActive(items: AgentTodoItem[]): boolean {
  if (items.length === 0) return false;
  return items.some((item) => item.status === "pending" || item.status === "in_progress");
}

export function buildTodoReminder(items: AgentTodoItem[]): string {
  const progress = summarizeTodoProgress(items);
  const list = items.length > 0
    ? items.map((item) => `- [${item.status}] ${item.content}`).join("\n")
    : "（尚未创建任务计划）";

  return [
    "提醒：你已经连续 3 轮未调用 TodoWrite 更新任务计划。",
    "请先回顾用户最初目标，用 TodoWrite 标记已完成步骤、更新 in_progress，并确认下一步仍围绕该目标。",
    "TodoWrite 不执行任何实际操作，仅用于规划与进度跟踪。",
    `当前进度：${progress}`,
    "当前任务列表：",
    list,
  ].join("\n");
}
