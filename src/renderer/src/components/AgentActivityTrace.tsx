import React from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { splitTraceItems } from "@shared/agent-activity";
import { ProcessTracePanel } from "./ProcessTracePanel";
import { TaskPlanCard } from "./TaskPlanCard";

interface AgentActivityTraceProps {
  items: AgentActivityItem[];
  /** 实时流式展示时默认展开当前段 */
  live?: boolean;
}

export const AgentActivityTrace: React.FC<AgentActivityTraceProps> = ({
  items,
  live = false,
}) => {
  const { processItems, standaloneItems } = splitTraceItems(items);
  if (processItems.length === 0 && standaloneItems.length === 0) return null;

  return (
    <div className={`agent-activity-trace${live ? " agent-activity-trace--live" : ""}`}>
      {processItems.length > 0 && (
        <ProcessTracePanel items={processItems} live={live} />
      )}
      {standaloneItems.map((item) => {
        if (item.kind === "taskgraph" && item.tasks.length > 0) {
          return (
            <TaskPlanCard
              key={item.id}
              goal={item.goal}
              tasks={item.tasks}
              live={live}
            />
          );
        }
        return null;
      })}
    </div>
  );
};
