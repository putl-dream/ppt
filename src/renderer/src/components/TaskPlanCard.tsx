import React, { useState } from "react";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import { formatTaskPlanPosition } from "@shared/agent-task-graph";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";

function TaskStatusIcon({ status }: { status: AgentTaskNode["status"] }) {
  if (status === "completed") return <span className="task-plan-icon done" aria-hidden="true">✓</span>;
  if (status === "in_progress") return <span className="step-spinner task-plan-spinner" aria-hidden="true" />;
  if (status === "submitted") return <span className="task-plan-icon submitted" aria-hidden="true">◇</span>;
  return <span className="task-plan-icon pending" aria-hidden="true">○</span>;
}

interface TaskPlanCardProps {
  goal?: string | null;
  tasks: AgentTaskNode[];
  live?: boolean;
}

export const TaskPlanCard: React.FC<TaskPlanCardProps> = ({
  goal,
  tasks,
  live = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasActive = tasks.some(
    (task) => task.status === "in_progress" || task.status === "submitted",
  );

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
        <span className="task-plan-card-position">{formatTaskPlanPosition(tasks)}</span>
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
              {tasks.map((task, index) => (
                <li
                  key={task.id}
                  className={`task-plan-item task-plan-item--${task.status}`}
                >
                  <TaskStatusIcon status={task.status} />
                  <span>
                    {(task.status === "in_progress" || task.status === "submitted") && (
                      <span className="task-plan-step-marker">
                        {task.status === "submitted" ? "待验收" : `步骤 ${index + 1}`} ·{" "}
                      </span>
                    )}
                    {task.subject}
                    {task.owner ? ` · ${task.owner}` : ""}
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
