import React from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { filterTraceForDisplay, findPendingToolApproval } from "@shared/agent-activity";
import { AgentActivityTrace } from "./AgentActivityTrace";

interface AgentThinkingLoaderProps {
  busy: boolean;
  agentActivityMode: "idle" | "request" | "workflow" | "reasoning";
  activityTrace: AgentActivityItem[];
  activeToolName?: string | null;
  /** 已有流式回复消息时，时间线改挂在消息上，避免重复展示 */
  suppressTrace?: boolean;
}

function getStatusLabel(
  agentActivityMode: AgentThinkingLoaderProps["agentActivityMode"],
  activeToolName: string | null | undefined,
  activityTrace: AgentActivityItem[],
): string {
  const pendingApproval = findPendingToolApproval(activityTrace);
  if (pendingApproval) {
    return `等待授权：${pendingApproval.reason}`;
  }

  const runningTask = [...activityTrace].reverse().find(
    (item) => item.kind === "task" && item.status === "running",
  );
  if (runningTask?.kind === "task") {
    const activeStep = [...runningTask.steps].reverse().find(
      (step) => step.status === "running" || step.streaming,
    );
    if (activeStep) {
      return activeStep.text;
    }
    return `子任务：${runningTask.description}`;
  }

  if (activeToolName) {
    return `正在调用工具：${activeToolName}`;
  }
  if (agentActivityMode === "reasoning") {
    return "模型思考中…";
  }
  if (agentActivityMode === "workflow") {
    return "正在执行工作流…";
  }
  if (agentActivityMode === "request") {
    const lastStep = [...activityTrace].reverse().find((item) => item.kind === "step");
    return lastStep?.kind === "step" ? lastStep.text : "正在处理请求…";
  }
  return "AI 正在处理…";
}

export const AgentThinkingLoader: React.FC<AgentThinkingLoaderProps> = ({
  busy,
  agentActivityMode,
  activityTrace,
  activeToolName = null,
  suppressTrace = false,
}) => {
  if (!busy || agentActivityMode === "idle") return null;

  const displayTrace = filterTraceForDisplay(activityTrace);
  const hasTrace = !suppressTrace && displayTrace.length > 0;
  const statusLabel = getStatusLabel(agentActivityMode, activeToolName, activityTrace);
  const showSpinner = !findPendingToolApproval(activityTrace);

  return (
    <div className="chat-message assistant thinking-message agent-activity-panel">
      <div className="agent-activity-status-bar">
        {showSpinner && (
          <div className="thinking-dots-container">
            <span className="thinking-dot" />
            <span className="thinking-dot" />
            <span className="thinking-dot" />
          </div>
        )}
        <span className="agent-activity-status-label">{statusLabel}</span>
      </div>

      {hasTrace && (
        <AgentActivityTrace
          items={displayTrace}
          live
        />
      )}
    </div>
  );
};
