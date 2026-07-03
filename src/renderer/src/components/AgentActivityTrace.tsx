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
          {item.summary && (
            <div className="agent-tool-block-summary">{item.summary}</div>
          )}
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
      {items.map((item, index) => {
        if (item.kind === "reasoning") {
          const reasoningTotal = items.filter((entry) => entry.kind === "reasoning").length;
          const reasoningRound = (item.modelStep ?? 0) + 1;
          const showRound = reasoningTotal > 1 || (item.modelStep ?? 0) > 0;
          const reasoningLabel = showRound
            ? (live && item.streaming ? `思考中 · 第 ${reasoningRound} 轮` : `思考过程 · 第 ${reasoningRound} 轮`)
            : undefined;

          return (
            <ReasoningBlock
              key={item.id}
              content={item.content}
              label={reasoningLabel}
              defaultExpanded={live}
              isStreaming={live && Boolean(item.streaming)}
            />
          );
        }
        if (item.kind === "tool") {
          return <ToolCallBlock key={item.id} item={item} live={live} />;
        }
        if (item.kind === "tool-summary") {
          return (
            <div key={item.id} className="agent-tool-summary-preview">
              <div className="agent-tool-summary-preview-label">
                {live && item.streaming ? "方案摘要（生成中）" : "方案摘要"}
              </div>
              <pre className="agent-tool-summary-preview-text">{item.content}</pre>
            </div>
          );
        }
        return <WorkflowStepBlock key={item.id} item={item} live={live} />;
      })}
    </div>
  );
};
