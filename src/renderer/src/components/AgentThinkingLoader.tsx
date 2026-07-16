import React from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { filterTraceForDisplay } from "@shared/agent-activity";
import { AgentActivityTrace } from "./AgentActivityTrace";
import type { AgentTaskNode } from "@shared/agent-task-graph";

interface AgentThinkingLoaderProps {
  busy: boolean;
  agentActivityMode: "idle" | "request" | "workflow" | "reasoning";
  activityTrace: AgentActivityItem[];
  /** 已有流式回复消息时，时间线改挂在消息上，避免重复展示 */
  suppressTrace?: boolean;
  teamGraphTasks?: AgentTaskNode[];
  teamSessionAttentionIds?: ReadonlySet<string>;
  onFocusTeamSession?: (sessionId: string) => void;
}

export const AgentThinkingLoader: React.FC<AgentThinkingLoaderProps> = ({
  busy,
  agentActivityMode,
  activityTrace,
  suppressTrace = false,
  teamGraphTasks,
  teamSessionAttentionIds,
  onFocusTeamSession,
}) => {
  if (!busy || agentActivityMode === "idle" || suppressTrace) return null;

  const displayTrace = filterTraceForDisplay(activityTrace);
  if (displayTrace.length === 0) return null;

  return (
    <div className="chat-message assistant agent-activity-panel">
      <AgentActivityTrace
        items={displayTrace}
        live
        teamGraphTasks={teamGraphTasks}
        teamSessionAttentionIds={teamSessionAttentionIds}
        onFocusTeamSession={onFocusTeamSession}
      />
    </div>
  );
};
