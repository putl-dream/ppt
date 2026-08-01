import type { AgentActivityItem } from "@shared/agent-activity";
import {
  formatAgentProgressMessage,
  formatAgentToolActivity,
  getAgentToolDisplayCopy,
  type AgentToolDisplayCategory,
} from "@shared/agent-activity-display";

export interface ProcessTraceRow {
  id: string;
  kind: "thought" | "progress" | "tool" | "task" | "approval";
  title: string;
  content?: string;
  active?: boolean;
  streaming?: boolean;
  lines?: string[];
  status?: "running" | "completed" | "failed" | "denied" | "invalid-input";
  toolCategory?: AgentToolDisplayCategory;
}

function pushRow(
  rows: ProcessTraceRow[],
  row: ProcessTraceRow,
) {
  if ((row.kind === "progress" || row.kind === "tool") && row.title.trim()) {
    rows.push(row);
    return;
  }
  if (row.content?.trim() || (row.lines && row.lines.length > 0)) {
    rows.push(row);
    return;
  }
  if (row.active) {
    rows.push(row);
  }
}

export function buildProcessTraceRows(
  items: AgentActivityItem[],
  live: boolean,
): ProcessTraceRow[] {
  const rows: ProcessTraceRow[] = [];
  const reasoningTotal = items.filter((item) => item.kind === "reasoning").length;
  let reasoningIndex = 0;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]!;
    if (item.kind === "reasoning") {
      reasoningIndex += 1;
      const reasoningRound = (item.modelStep ?? reasoningIndex - 1) + 1;
      const showRound = reasoningTotal > 1 || (item.modelStep ?? 0) > 0;
      const title = live && item.streaming
        ? "思考中"
        : (showRound ? `思考片刻 · 第 ${reasoningRound} 轮` : "思考片刻");
      pushRow(rows, {
        id: item.id,
        kind: "thought",
        title,
        content: item.content,
        active: live && Boolean(item.streaming),
        streaming: live && Boolean(item.streaming),
      });
      continue;
    }

    if (item.kind === "tool") {
      const isRunning = item.status === "running";
      pushRow(rows, {
        id: item.id,
        kind: "tool",
        title: formatAgentToolActivity(item.toolName, item.status),
        active: isRunning && live,
        status: item.status,
        toolCategory: getAgentToolDisplayCopy(item.toolName).category,
      });
      continue;
    }

    if (item.kind === "tool-approval") {
      if (item.status === "pending") continue;
      const statusLabel = item.status === "approved" ? "已允许" : "已拒绝";
      pushRow(rows, {
        id: item.id,
        kind: "approval",
        title: `操作授权 · ${getAgentToolDisplayCopy(item.toolName).action}`,
        lines: [item.reason, `状态：${statusLabel}`],
      });
      continue;
    }

    if (item.kind === "task") {
      const isRunning = item.status === "running";
      const title = isRunning
        ? "正在处理任务"
        : item.status === "failed"
          ? "任务执行失败"
          : item.status === "interrupted" || item.status === "cancelled"
            ? "任务已取消"
            : "任务已完成";
      pushRow(rows, {
        id: item.id,
        kind: "task",
        title,
        lines: item.steps.length > 0 ? [item.description] : (isRunning && live ? ["正在准备任务…"] : [item.description]),
        active: isRunning && live,
      });

      for (const step of item.steps) {
        if (step.type === "reasoning") {
          pushRow(rows, {
            id: step.id,
            kind: "thought",
            title: live && step.streaming ? "任务分析中" : "任务分析",
            content: step.text,
            active: live && Boolean(step.streaming),
            streaming: live && Boolean(step.streaming),
          });
          continue;
        }
        const stepRunning = step.status === "running";
        const stepText = step.toolName
          ? formatAgentToolActivity(
              step.toolName,
              step.status,
            )
          : (formatAgentProgressMessage(step.text) ?? "正在处理任务…");
        pushRow(rows, {
          id: step.id,
          kind: "task",
          title: "任务步骤",
          lines: [stepText],
          active: stepRunning && live,
        });
      }
      continue;
    }

    if (item.kind === "step") {
      const status = item.status ?? "done";
      const isActive = live && (status === "typing" || status === "running");
      const title = formatAgentProgressMessage(item.text);
      if (!title) continue;
      pushRow(rows, {
        id: item.id,
        kind: "progress",
        title,
        active: isActive,
      });
    }
  }

  return rows;
}
