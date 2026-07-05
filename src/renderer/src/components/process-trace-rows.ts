import type { AgentActivityItem } from "@shared/agent-activity";

export interface ProcessTraceRow {
  id: string;
  title: string;
  content?: string;
  active?: boolean;
  streaming?: boolean;
  lines?: string[];
}

function pushRow(
  rows: ProcessTraceRow[],
  row: ProcessTraceRow,
) {
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

  for (const item of items) {
    if (item.kind === "reasoning") {
      reasoningIndex += 1;
      const reasoningRound = (item.modelStep ?? reasoningIndex - 1) + 1;
      const showRound = reasoningTotal > 1 || (item.modelStep ?? 0) > 0;
      const title = showRound
        ? (live && item.streaming ? `模型思考 · 第 ${reasoningRound} 轮` : `模型思考 · 第 ${reasoningRound} 轮`)
        : (live && item.streaming ? "模型思考" : "模型思考");
      pushRow(rows, {
        id: item.id,
        title,
        content: item.content,
        active: live && Boolean(item.streaming),
        streaming: live && Boolean(item.streaming),
      });
      continue;
    }

    if (item.kind === "tool") {
      const isRunning = item.status === "running";
      const lines = [item.label];
      if (item.summary) lines.push(item.summary);
      if (item.finishedLabel) lines.push(item.finishedLabel);
      pushRow(rows, {
        id: item.id,
        title: isRunning && live ? `工具调用 · ${item.toolName}` : `工具调用 · ${item.toolName}`,
        lines,
        active: isRunning && live,
      });
      continue;
    }

    if (item.kind === "tool-summary") {
      pushRow(rows, {
        id: item.id,
        title: live && item.streaming ? "方案摘要" : "方案摘要",
        content: item.content,
        active: live && Boolean(item.streaming),
        streaming: live && Boolean(item.streaming),
      });
      continue;
    }

    if (item.kind === "tool-approval") {
      if (item.status === "pending") continue;
      const statusLabel = item.status === "approved" ? "已允许" : "已拒绝";
      pushRow(rows, {
        id: item.id,
        title: `工具授权 · ${item.toolName}`,
        lines: [item.reason, `状态：${statusLabel}`],
      });
      continue;
    }

    if (item.kind === "task") {
      const isRunning = item.status === "running";
      pushRow(rows, {
        id: item.id,
        title: isRunning && live ? "子任务" : "子任务",
        lines: item.steps.length > 0 ? [item.description] : (isRunning && live ? ["正在准备子任务…"] : [item.description]),
        active: isRunning && live,
      });

      for (const step of item.steps) {
        if (step.type === "reasoning") {
          pushRow(rows, {
            id: step.id,
            title: live && step.streaming ? "子任务思考" : "子任务思考",
            content: step.text,
            active: live && Boolean(step.streaming),
            streaming: live && Boolean(step.streaming),
          });
          continue;
        }
        const stepRunning = step.status === "running";
        pushRow(rows, {
          id: step.id,
          title: "子任务步骤",
          lines: [step.text],
          active: stepRunning && live,
        });
      }
      continue;
    }

    if (item.kind === "step") {
      const status = item.status ?? "done";
      const isActive = live && (status === "typing" || status === "running");
      pushRow(rows, {
        id: item.id,
        title: "工作流步骤",
        lines: [item.text],
        active: isActive,
      });
    }
  }

  return rows;
}
