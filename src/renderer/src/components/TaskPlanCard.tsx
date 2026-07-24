import React, { useEffect, useState } from "react";
import type { AgentTaskNode } from "@shared/agent-task-list";
import {
  formatTaskOwnerForDisplay,
  formatTaskPlanPosition,
} from "@shared/agent-task-list";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

function TaskStatusIcon({ task }: { task: AgentTaskNode }) {
  if (task.review.state === "requested") return <span className="task-plan-icon review-requested" aria-hidden="true">◇</span>;
  const { status } = task;
  if (status === "completed") return <span className="task-plan-icon done" aria-hidden="true">✓</span>;
  if (status === "in_progress") return <span className="step-spinner task-plan-spinner" aria-hidden="true" />;
  return <span className="task-plan-icon pending" aria-hidden="true">○</span>;
}

interface TaskPlanCardProps {
  goal?: string | null;
  tasks: AgentTaskNode[];
  live?: boolean;
  state?: "open" | "closed" | "archived";
  archive?: { outcome: "completed" | "abandoned"; reason?: string };
}

export const TaskPlanCard: React.FC<TaskPlanCardProps> = ({
  goal,
  tasks,
  live = false,
  state = "open",
  archive,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasActive = tasks.some(
    (task) => task.status === "in_progress" || task.review.state === "requested",
  );

  useEffect(() => {
    if (hasActive) {
      setExpanded(true);
      return;
    }
    const timer = window.setTimeout(() => setExpanded(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [hasActive]);

  if (tasks.length === 0) return null;

  return (
    <div className={`task-plan-card${hasActive && live ? " task-plan-card--active" : ""}`}>
      <button
        type="button"
        className="task-plan-card-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="task-plan-card-title">任务计划</span>
        <span className="task-plan-card-position">
          {state === "archived" && archive?.outcome === "abandoned"
            ? `已放弃${archive.reason ? ` · ${archive.reason}` : ""}`
            : state === "archived"
              ? "已归档 · 全部完成"
              : formatTaskPlanPosition(tasks)}
        </span>
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
          {tasks.length > 0 && (
            <ul className="task-plan-list">
              {tasks.map((task, index) => {
                const displayOwner = formatTaskOwnerForDisplay(task);
                return (
                  <li
                    key={task.id}
                    className={`task-plan-item task-plan-item--${
                      task.review.state === "requested" ? "review-requested" : task.status
                    }`}
                  >
                    <TaskStatusIcon task={task} />
                    <span>
                      {(task.status === "in_progress" || task.review.state === "requested") && (
                        <span className="task-plan-step-marker">
                          {task.review.state === "requested" ? "待验收" : `步骤 ${index + 1}`} ·{" "}
                        </span>
                      )}
                      {task.subject}
                      {displayOwner ? ` · ${displayOwner}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
