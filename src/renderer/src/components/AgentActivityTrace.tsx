import React, { useEffect, useState } from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { ReasoningBlock } from "./ReasoningBlock";

interface AgentActivityTraceProps {
  items: AgentActivityItem[];
  /** 实时流式展示时默认展开当前段 */
  live?: boolean;
}

function ToolCallBlock({
  item,
  live,
}: {
  item: Extract<AgentActivityItem, { kind: "tool" }>;
  live: boolean;
}) {
  const isRunning = item.status === "running";
  const [expanded, setExpanded] = useState(isRunning || live);

  useEffect(() => {
    if (isRunning && live) {
      setExpanded(true);
    }
  }, [isRunning, live]);

  const headerLabel = isRunning
    ? `调用工具：${item.toolName}`
    : `工具调用：${item.toolName}`;

  return (
    <div className={`reasoning-block agent-tool-block${isRunning && live ? " reasoning-block--streaming" : ""}`}>
      <button
        type="button"
        className="reasoning-block-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {isRunning && live && <span className="step-spinner" aria-hidden="true" />}
        <span className="reasoning-block-label">{headerLabel}</span>
        {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      {expanded && (
        <div className="agent-tool-block-body">
          <div className={`agent-tool-block-step${isRunning ? " running" : " done"}`}>
            {item.label}
          </div>
          {item.finishedLabel && (
            <div className="agent-tool-block-step done">{item.finishedLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkflowStepBlock({
  item,
  live,
}: {
  item: Extract<AgentActivityItem, { kind: "step" }>;
  live: boolean;
}) {
  const status = item.status ?? "done";
  const isActive = live && (status === "typing" || status === "running");

  return (
    <div className={`agent-step-block${isActive ? " agent-step-block--active" : ""}`}>
      <div className="agent-step-block-row">
        {status === "running" && live && <span className="step-spinner" aria-hidden="true" />}
        <span className={status === "typing" && live ? "typing" : status === "done" ? "done" : ""}>
          {item.text}
        </span>
      </div>
    </div>
  );
}

export const AgentActivityTrace: React.FC<AgentActivityTraceProps> = ({
  items,
  live = false,
}) => {
  if (items.length === 0) return null;

  return (
    <div className={`agent-activity-trace${live ? " agent-activity-trace--live" : ""}`}>
      {items.map((item) => {
        if (item.kind === "reasoning") {
          return (
            <ReasoningBlock
              key={item.id}
              content={item.content}
              defaultExpanded={live}
              isStreaming={live && Boolean(item.streaming)}
            />
          );
        }
        if (item.kind === "tool") {
          return <ToolCallBlock key={item.id} item={item} live={live} />;
        }
        return <WorkflowStepBlock key={item.id} item={item} live={live} />;
      })}
    </div>
  );
};
