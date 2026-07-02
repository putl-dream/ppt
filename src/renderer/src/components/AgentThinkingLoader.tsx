import React from "react";

interface AgentThinkingLoaderProps {
  busy: boolean;
  agentActivityMode: "idle" | "request" | "workflow" | "reasoning";
  thoughtProcess: string[];
}

export const AgentThinkingLoader: React.FC<AgentThinkingLoaderProps> = ({
  busy,
  agentActivityMode,
  thoughtProcess,
}) => {
  // 文本流或模型思考流开始后隐藏工作流动画
  if (!busy || agentActivityMode === "idle" || agentActivityMode === "reasoning") return null;

  const currentStep = thoughtProcess.at(-1) || "AI 正在思考中...";

  return (
    <div className="chat-message assistant thinking-message">
      <div className="thinking-status">
        <div className="thinking-dots-container">
          <span className="thinking-dot"></span>
          <span className="thinking-dot"></span>
          <span className="thinking-dot"></span>
        </div>
        <span className="thinking-text-label">{currentStep}</span>
      </div>
    </div>
  );
};
