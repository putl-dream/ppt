import type { AgentActivityItem } from "./agent-activity";
import { formatAgentToolActivity } from "./agent-activity-display";
import type { AgentTaskNode } from "./agent-task-list";

export type TeamSessionStatus = "running" | "completed" | "error" | "cancelled";

export type TeamTaskActivity = Extract<AgentActivityItem, { kind: "task" }>;

export interface TeamSessionProjection {
  id: string;
  parentId?: string;
  agentName: string;
  title: string;
  currentActivity: string;
  status: TeamSessionStatus;
  toolCount: number;
  stepCount: number;
  taskListId?: string;
  activity: TeamTaskActivity;
}

export function toTeamSessionStatus(
  status: TeamTaskActivity["status"],
): TeamSessionStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "error";
  if (status === "interrupted" || status === "cancelled") return "cancelled";
  return "running";
}

export function projectTeamCurrentActivity(activity: TeamTaskActivity): string {
  const lastStep = activity.steps.at(-1);
  if (activity.status === "completed") return "已完成，等待 lead 汇总";
  if (activity.status === "failed") {
    if (lastStep?.type === "tool") {
      return formatAgentToolActivity(
        lastStep.toolName ?? "task",
        "failed",
      );
    }
    return "任务执行失败，等待 lead 处理";
  }
  if (activity.status === "interrupted" || activity.status === "cancelled") {
    return "任务已取消";
  }
  if (!lastStep) return "正在准备任务…";
  if (lastStep.type === "reasoning") return "正在分析任务上下文…";

  return formatAgentToolActivity(
    lastStep.toolName ?? "task",
    lastStep.status,
  );
}

export function projectTeamSession(
  activity: TeamTaskActivity,
  graphTasks: readonly AgentTaskNode[] = [],
): TeamSessionProjection {
  const taskListId = activity.taskListId
    ?? (graphTasks.some((task) => task.id === activity.taskId) ? activity.taskId : undefined);
  const graphTask = taskListId
    ? graphTasks.find((task) => task.id === taskListId)
    : undefined;
  const description = activity.description.trim();
  return {
    id: activity.taskId,
    ...(activity.parentTaskId ? { parentId: activity.parentTaskId } : {}),
    agentName: activity.agentName ?? "协作助手",
    title: graphTask?.subject.trim() || description || "未命名子任务",
    currentActivity: projectTeamCurrentActivity(activity),
    status: toTeamSessionStatus(activity.status),
    toolCount: activity.steps.filter((step) => step.type === "tool").length,
    stepCount: activity.steps.length,
    ...(taskListId ? { taskListId } : {}),
    activity,
  };
}

/**
 * Merge repeated live/persisted activity snapshots by session id. Later traces win,
 * which mirrors the renderer's append-only message order.
 */
export function collectTeamSessions(
  traces: ReadonlyArray<readonly AgentActivityItem[] | undefined>,
  graphTasks: readonly AgentTaskNode[] = [],
): TeamSessionProjection[] {
  const activities = new Map<string, TeamTaskActivity>();
  for (const trace of traces) {
    for (const item of trace ?? []) {
      if (item.kind === "task") activities.set(item.taskId, item);
    }
  }
  return Array.from(activities.values()).map((activity) =>
    projectTeamSession(activity, graphTasks)
  );
}

export function teamSessionFingerprint(session: TeamSessionProjection): string {
  const lastStep = session.activity.steps.at(-1);
  return [
    session.status,
    session.currentActivity,
    session.stepCount,
    lastStep?.id ?? "",
    lastStep?.status ?? "",
    lastStep?.text.length ?? 0,
  ].join(":");
}
