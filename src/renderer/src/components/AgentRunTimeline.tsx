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

        // Keep the process panel open for the whole agent run (Cursor-style).
        // Gating on per-tool/reasoning activity made segmentLive flicker false
        // between steps and thrash open/close via collapseOnComplete.
        // #region agent log
        fetch('http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'482d6b'},body:JSON.stringify({sessionId:'482d6b',runId:'post-fix',hypothesisId:'A',location:'AgentRunTimeline.tsx:segmentLive',message:'activity segment live calc',data:{runLive:live,segmentLive:live,collapseOnComplete:segment.items.length>1,itemCount:segment.items.length,panelKey:segment.items[0]?.id,statuses:segment.items.map((i)=>i.kind==='tool'?{id:i.id,kind:'tool',status:i.status}:i.kind==='reasoning'?{id:i.id,kind:'reasoning',streaming:i.streaming}:{id:i.id,kind:i.kind})},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return (
          <div
            key={segment.items[0]!.id}
            className="agent-run-activity-cluster"
          >
            <ProcessTracePanel
              items={segment.items}
              live={live}
              defaultOpen={segment.items.length === 1}
              collapseOnComplete={segment.items.length > 1}
            />
          </div>
        );
      })}
    </div>
  );
};
