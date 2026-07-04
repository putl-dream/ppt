import React from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { filterTraceForDisplay, findPendingToolApproval } from "@shared/agent-activity";
import { AgentActivityTrace } from "./AgentActivityTrace";
import { StopIcon } from "./Icons";

interface AgentThinkingLoaderProps {
  busy: boolean;
  agentActivityMode: "idle" | "request" | "workflow" | "reasoning";
  activityTrace: AgentActivityItem[];
  activeToolName?: string | null;
  /** 已有流式回复消息时，时间线改挂在消息上，避免重复展示 */
  suppressTrace?: boolean;
  canCancelRun?: boolean;
  onCancelRun?: () => void;
  isCancellingRun?: boolean;
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
      // 思考步骤的文本已在下方 ReasoningBlock 中完整展示，状态栏只给出概括标签，避免重复
      if (activeStep.type === "reasoning") {
        return "子任务思考中…";
      }
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
  canCancelRun = false,
  onCancelRun,
  isCancellingRun = false,
}) => {
  if (!busy || agentActivityMode === "idle") return null;

  const displayTrace = filterTraceForDisplay(activityTrace);
  const hasTrace = !suppressTrace && displayTrace.length > 0;
  const statusLabel = getStatusLabel(agentActivityMode, activeToolName, activityTrace);
  const showSpinner = !findPendingToolApproval(activityTrace);

  return (
    <div className="chat-message assistant thinking-message agent-activity-panel">
      <div className="agent-activity-status-bar">
        <div className="agent-activity-status-left">
          {showSpinner && (
            <div className="thinking-dots-container">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </div>
          )}
          <span className="agent-activity-status-label">
            {isCancellingRun ? "正在中断会话…" : statusLabel}
          </span>
        </div>
        {canCancelRun && onCancelRun && (
          <button
            type="button"
            className="agent-activity-stop-btn"
            onClick={onCancelRun}
            disabled={isCancellingRun}
            title="中断当前 Agent 会话"
          >
            <StopIcon size={12} />
            <span>{isCancellingRun ? "中断中…" : "停止"}</span>
          </button>
        )}
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
