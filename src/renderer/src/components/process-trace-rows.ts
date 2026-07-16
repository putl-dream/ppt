import type { AgentActivityItem } from "@shared/agent-activity";
import {
  formatAgentProgressMessage,
  formatAgentToolActivity,
  getAgentToolDisplayCopy,
  inferAgentToolActivityState,
  type AgentToolDisplayCategory,
} from "@shared/agent-activity-display";

export interface ProcessTraceRow {
  id: string;
  kind: "thought" | "progress" | "tools" | "task" | "approval";
  title: string;
  content?: string;
  active?: boolean;
  streaming?: boolean;
  lines?: string[];
}

type ToolTraceItem = Extract<AgentActivityItem, { kind: "tool" }>;

function summarizeToolBatch(tools: ToolTraceItem[]): string {
  const counts = new Map<AgentToolDisplayCategory, number>();
  for (const tool of tools) {
    const category = getAgentToolDisplayCopy(tool.toolName).category;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const labels: Record<AgentToolDisplayCategory, (count: number) => string> = {
    read: (count) => `读取 ${count} 项`,
    search: (count) => `搜索 ${count} 次`,
    inspect: (count) => `检查 ${count} 次`,
    change: (count) => `执行 ${count} 项`,
    coordinate: (count) => `协调 ${count} 项`,
    other: (count) => `处理 ${count} 项`,
  };
  const order: AgentToolDisplayCategory[] = [
    "read",
    "search",
    "inspect",
    "change",
    "coordinate",
    "other",
  ];
  return order
    .filter((category) => counts.has(category))
    .map((category) => labels[category](counts.get(category)!))
    .join(" · ");
}

function toolDetailLines(tools: ToolTraceItem[]): string[] {
  return tools.flatMap((tool) => {
    const rawStatus = tool.status === "running"
      ? tool.label
      : (tool.finishedLabel ?? tool.label);
    const fallbackState = tool.status === "running"
      ? "running"
      : (tool.finishedLabel ? "completed" : "failed");
    const state = inferAgentToolActivityState(rawStatus, fallbackState);
    return [
      formatAgentToolActivity(tool.toolName, state),
      ...(tool.summary?.trim() ? [tool.summary.trim()] : []),
    ];
  });
}

function pushRow(
  rows: ProcessTraceRow[],
  row: ProcessTraceRow,
) {
  if (row.kind === "progress" && row.title.trim()) {
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
      const tools: ToolTraceItem[] = [item];
      while (items[itemIndex + 1]?.kind === "tool") {
        tools.push(items[itemIndex + 1] as ToolTraceItem);
        itemIndex += 1;
      }
      const isRunning = tools.some((tool) => tool.status === "running");
      const summary = summarizeToolBatch(tools);
      pushRow(rows, {
        id: `tool-batch-${tools[0]!.id}`,
        kind: "tools",
        title: isRunning && live ? `正在${summary}` : summary,
        lines: toolDetailLines(tools),
        active: isRunning && live,
      });
      continue;
    }

    if (item.kind === "tool-summary") {
      pushRow(rows, {
        id: item.id,
        kind: "tools",
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
        kind: "approval",
        title: `操作授权 · ${getAgentToolDisplayCopy(item.toolName).action}`,
        lines: [item.reason, `状态：${statusLabel}`],
      });
      continue;
    }

    if (item.kind === "task") {
      const isRunning = item.status === "running";
      const title = isRunning
        ? "正在处理子任务"
        : item.status === "failed"
          ? "子任务执行失败"
          : item.status === "interrupted" || item.status === "cancelled"
            ? "子任务已取消"
            : "子任务已完成";
      pushRow(rows, {
        id: item.id,
        kind: "task",
        title,
        lines: item.steps.length > 0 ? [item.description] : (isRunning && live ? ["正在准备子任务…"] : [item.description]),
        active: isRunning && live,
      });

      for (const step of item.steps) {
        if (step.type === "reasoning") {
          pushRow(rows, {
            id: step.id,
            kind: "thought",
            title: live && step.streaming ? "子任务思考中" : "子任务思考",
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
              inferAgentToolActivityState(
                step.text,
                stepRunning ? "running" : "completed",
              ),
            )
          : (formatAgentProgressMessage(step.text) ?? "正在处理子任务…");
        pushRow(rows, {
          id: step.id,
          kind: "task",
          title: "子任务步骤",
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
