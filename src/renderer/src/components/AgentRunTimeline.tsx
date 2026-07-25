import React from "react";
import {
  getResponseBlockContent,
  type AgentActivityItem,
} from "@shared/agent-activity";
import type { AgentTaskNode } from "@shared/agent-task-list";
import { ProcessTraceItem } from "./ProcessTraceItem";
import { buildProcessTraceRows } from "./process-trace-rows";
import { TeamSessionCards } from "./TeamSessionViews";
import { TypewriterMarkdown } from "./TypewriterMarkdown";

interface AgentRunTimelineProps {
  items: AgentActivityItem[];
  content: string;
  live?: boolean;
  teamGraphTasks?: AgentTaskNode[];
  teamSessionAttentionIds?: ReadonlySet<string>;
  onFocusTeamSession?: (sessionId: string) => void;
}

export const AgentRunTimeline: React.FC<AgentRunTimelineProps> = ({
  items,
  content,
  live = false,
  teamGraphTasks = [],
  teamSessionAttentionIds,
  onFocusTeamSession,
}) => {
  if (items.length === 0) return null;

  return (
    <div className="agent-run-timeline">
      {items.map((item) => {
        if (item.kind === "response") {
          return (
            <div
              key={item.id}
              className="agent-run-block agent-run-block--response"
              data-run-block-id={item.id}
              data-run-block-kind="response"
            >
              <TypewriterMarkdown
                content={getResponseBlockContent(item, content)}
                active={live && Boolean(item.streaming)}
                className="assistant-response"
              />
            </div>
          );
        }

        if (item.kind === "tasklist") return null;

        if (item.kind === "task" && onFocusTeamSession) {
          return (
            <div
              key={item.id}
              className="agent-run-block agent-run-block--task"
              data-run-block-id={item.id}
              data-run-block-kind="task"
            >
              <TeamSessionCards
                activities={[item]}
                graphTasks={teamGraphTasks}
                attentionIds={teamSessionAttentionIds}
                onFocus={onFocusTeamSession}
              />
            </div>
          );
        }

        const rows = buildProcessTraceRows([item], live);
        if (rows.length === 0) return null;
        return (
          <div
            key={item.id}
            className="agent-run-block agent-run-block--activity"
            data-run-block-id={item.id}
            data-run-block-kind={item.kind}
          >
            {rows.map((row) => (
              <ProcessTraceItem
                key={row.id}
                row={row}
                defaultExpanded={Boolean(row.active && row.kind !== "thought")}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};
