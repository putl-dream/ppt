import React from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { AgentActivityTrace } from "./AgentActivityTrace";

interface AgentThinkingLoaderProps {
  busy: boolean;
  agentActivityMode: "idle" | "request" | "workflow" | "reasoning";
  activityTrace: AgentActivityItem[];
  activeToolName?: string | null;
}

function getStatusLabel(
  agentActivityMode: AgentThinkingLoaderProps["agentActivityMode"],
  activeToolName: string | null | undefined,
  activityTrace: AgentActivityItem[],
): string {
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
}) => {
  if (!busy || agentActivityMode === "idle") return null;

  const hasTrace = activityTrace.length > 0;
  const statusLabel = getStatusLabel(agentActivityMode, activeToolName, activityTrace);

  return (
    <div className="chat-message assistant thinking-message agent-activity-panel">
      <div className="agent-activity-status-bar">
        <div className="thinking-dots-container">
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
        </div>
        <span className="agent-activity-status-label">{statusLabel}</span>
      </div>

      {hasTrace && <AgentActivityTrace items={activityTrace} live />}
    </div>
  );
};
