import React from "react";
import type { AgentActivityItem } from "@shared/agent-activity";
import { splitTraceItems } from "@shared/agent-activity";
import { ProcessTracePanel } from "./ProcessTracePanel";
import { TaskPlanCard } from "./TaskPlanCard";

interface AgentActivityTraceProps {
  items: AgentActivityItem[];
  /** 实时流式展示时默认展开当前段 */
  live?: boolean;
  /** 运行期间的模型正文；与执行过程一起展示，完成后再回到消息正文区。 */
  liveContent?: string;
}

export const AgentActivityTrace: React.FC<AgentActivityTraceProps> = ({
  items,
  live = false,
  liveContent = "",
}) => {
  const { processItems, standaloneItems } = splitTraceItems(items);
  const hasLiveContent = Boolean(live && liveContent.trim());
  if (processItems.length === 0 && standaloneItems.length === 0 && !hasLiveContent) return null;

  return (
    <div className={`agent-activity-trace${live ? " agent-activity-trace--live" : ""}`}>
      {(processItems.length > 0 || hasLiveContent) && (
        <ProcessTracePanel items={processItems} live={live} liveContent={liveContent} />
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
