import React, { useState } from "react";
import type { AgentTodoItem } from "@shared/agent-todo";
import { formatTodoPosition } from "@shared/agent-todo";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

function TodoStatusIcon({ status }: { status: AgentTodoItem["status"] }) {
  if (status === "completed") return <span className="agent-todo-icon done" aria-hidden="true">✓</span>;
  if (status === "in_progress") return <span className="step-spinner agent-todo-spinner" aria-hidden="true" />;
  if (status === "cancelled") return <span className="agent-todo-icon cancelled" aria-hidden="true">—</span>;
  return <span className="agent-todo-icon pending" aria-hidden="true">○</span>;
}

interface TaskPlanCardProps {
  goal?: string | null;
  todos: AgentTodoItem[];
  live?: boolean;
}

export const TaskPlanCard: React.FC<TaskPlanCardProps> = ({
  goal,
  todos,
  live = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasActive = todos.some((todo) => todo.status === "in_progress");

  if (todos.length === 0) return null;

  return (
    <div className={`task-plan-card${hasActive && live ? " task-plan-card--active" : ""}`}>
      <button
        type="button"
        className="task-plan-card-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="task-plan-card-title">任务计划</span>
        <span className="task-plan-card-position">{formatTodoPosition(todos)}</span>
        {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
      </button>
      {expanded && (
        <div className="task-plan-card-body">
          {goal && (
            <div className="task-plan-card-goal">
              <span className="task-plan-card-goal-label">目标</span>
              <p className="task-plan-card-goal-text">{goal}</p>
            </div>
          )}
          {todos.length > 0 && (
            <ul className="agent-todo-list">
              {todos.map((todo, index) => (
                <li
                  key={todo.id}
                  className={`agent-todo-item agent-todo-item--${todo.status}`}
                >
                  <TodoStatusIcon status={todo.status} />
                  <span>
                    {todo.status === "in_progress" && (
                      <span className="task-plan-step-marker">步骤 {index + 1} · </span>
                    )}
                    {todo.content}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
