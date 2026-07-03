import React, { useEffect, useState } from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import type { AgentTodoItem } from "@shared/agent-todo";
import { summarizeTodoProgress } from "@shared/agent-todo";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { ReasoningBlock } from "./ReasoningBlock";

interface AgentActivityTraceProps {
  items: AgentActivityItem[];
  /** 实时流式展示时默认展开当前段 */
  live?: boolean;
  onResolveToolApproval?: (approvalId: string, approved: boolean) => void;
}

function TodoStatusIcon({ status }: { status: AgentTodoItem["status"] }) {
  if (status === "completed") return <span className="agent-todo-icon done" aria-hidden="true">✓</span>;
  if (status === "in_progress") return <span className="step-spinner agent-todo-spinner" aria-hidden="true" />;
  if (status === "cancelled") return <span className="agent-todo-icon cancelled" aria-hidden="true">—</span>;
  return <span className="agent-todo-icon pending" aria-hidden="true">○</span>;
}

function TodoBlock({
  item,
  live,
}: {
  item: Extract<AgentActivityItem, { kind: "todo" }>;
  live: boolean;
}) {
  const hasActive = item.todos.some((todo) => todo.status === "in_progress");
  const [expanded, setExpanded] = useState(live || hasActive);

  useEffect(() => {
    if (hasActive && live) {
      setExpanded(true);
    }
  }, [hasActive, live]);

  return (
    <div className={`agent-todo-block${hasActive && live ? " agent-todo-block--active" : ""}`}>
      <button
        type="button"
        className="agent-todo-block-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="agent-todo-block-title">任务计划</span>
        <span className="agent-todo-block-summary">{summarizeTodoProgress(item.todos)}</span>
        {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      {expanded && (
        <ul className="agent-todo-list">
          {item.todos.map((todo) => (
            <li
              key={todo.id}
              className={`agent-todo-item agent-todo-item--${todo.status}`}
            >
              <TodoStatusIcon status={todo.status} />
              <span>{todo.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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

function ToolApprovalBlock({
  item,
  onResolve,
}: {
  item: Extract<AgentActivityItem, { kind: "tool-approval" }>;
  onResolve?: (approvalId: string, approved: boolean) => void;
}) {
  const statusLabel = item.status === "pending"
    ? "等待确认"
    : item.status === "approved"
      ? "已允许"
      : "已拒绝";

  return (
    <div className="approval-card tool-approval-card">
      <div className="approval-card-title">
        工具操作确认 · {item.toolName}
      </div>
      <p className="approval-summary">{item.reason}</p>
      {item.detail && (
        <pre className="tool-approval-detail">{item.detail}</pre>
      )}
      <p className="approval-summary">状态：{statusLabel}</p>
      {item.status === "pending" && onResolve && (
        <div className="approval-buttons">
          <button type="button" onClick={() => onResolve(item.approvalId, false)}>
            拒绝
          </button>
          <button type="button" className="primary" onClick={() => onResolve(item.approvalId, true)}>
            允许
          </button>
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
  onResolveToolApproval,
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
        if (item.kind === "tool-approval") {
          return (
            <ToolApprovalBlock
              key={item.id}
              item={item}
              onResolve={onResolveToolApproval}
            />
          );
        }
        if (item.kind === "todo") {
          return <TodoBlock key={item.id} item={item} live={live} />;
        }
        return <WorkflowStepBlock key={item.id} item={item} live={live} />;
      })}
    </div>
  );
};
