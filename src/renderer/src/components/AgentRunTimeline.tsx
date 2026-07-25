import React from "react";
import {
  getResponseBlockContent,
  type AgentActivityItem,
} from "@shared/agent-activity";
import type { AgentTaskNode } from "@shared/agent-task-list";
import { ProcessTraceItem } from "./ProcessTraceItem";
import { buildProcessTraceRows } from "./process-trace-rows";
import { ProcessTracePanel } from "./ProcessTracePanel";
import { TypewriterMarkdown } from "./TypewriterMarkdown";

interface AgentRunTimelineProps {
  items: AgentActivityItem[];
  content: string;
  live?: boolean;
  teamGraphTasks?: AgentTaskNode[];
}

export const AgentRunTimeline: React.FC<AgentRunTimelineProps> = ({
  items,
  content,
  live = false,
  teamGraphTasks = [],
}) => {
  if (items.length === 0) {
    return content ? (
      <div className="agent-run-timeline">
        <TypewriterMarkdown content={content} active={live} className="assistant-response" />
      </div>
    ) : null;
  }

  const segments: Array<
    | { kind: "response"; item: Extract<AgentActivityItem, { kind: "response" }> }
    | { kind: "task"; item: Extract<AgentActivityItem, { kind: "task" }> }
    | { kind: "activity"; items: AgentActivityItem[] }
  > = [];

  for (const item of items) {
    if (item.kind === "tasklist") continue;
    if (item.kind === "response") {
      segments.push({ kind: "response", item });
      continue;
    }
    if (item.kind === "task") {
      segments.push({ kind: "task", item });
      continue;
    }
    const previous = segments.at(-1);
    if (previous?.kind === "activity") {
      previous.items.push(item);
    } else {
      segments.push({ kind: "activity", items: [item] });
    }
  }

  return (
    <div className="agent-run-timeline">
      {segments.map((segment) => {
        if (segment.kind === "response") {
          const item = segment.item;
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

        if (segment.kind === "task") {
          const item = segment.item;
          const graphTaskId = item.taskListId ?? item.taskId;
          if (teamGraphTasks.some((task) => task.id === graphTaskId)) {
            return null;
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
        }

        const segmentLive = live && segment.items.some((item) =>
          item.kind === "reasoning"
            ? item.streaming
            : item.kind === "tool"
              ? item.status === "running"
              : item.kind === "step"
                ? item.status !== "done"
                : false
        );
        return (
          <div
            key={segment.items[0]!.id}
            className="agent-run-activity-cluster"
          >
            <ProcessTracePanel
              items={segment.items}
              live={segmentLive}
              defaultOpen={segment.items.length === 1}
              collapseOnComplete={segment.items.length > 1}
            />
          </div>
        );
      })}
    </div>
  );
};
