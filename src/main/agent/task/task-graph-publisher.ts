import {
  filterTasksByPlan,
  type AgentTaskNode,
} from "@shared/agent-task-graph";
import type { TaskStore } from "./task-store";

export interface TaskGraphSnapshot {
  tasks: AgentTaskNode[];
  goal?: string | null;
}

export type TaskGraphSnapshotListener = (snapshot: TaskGraphSnapshot) => void;

export interface PublishedTaskGraph {
  /** Full durable graph for scheduler/tool consumers. */
  allTasks: AgentTaskNode[];
  /** Current-plan projection intended for the UI. */
  snapshot: TaskGraphSnapshot;
}

/**
 * Read the full durable graph, then publish only the currently selected plan.
 * Standalone legacy tasks remain visible when no plan metadata exists.
 */
export async function publishCurrentTaskGraph(
  store: TaskStore,
  listener?: TaskGraphSnapshotListener,
): Promise<PublishedTaskGraph> {
  const allTasks = await store.listTasks();
  const plan = await store.getPlanMeta();
  const snapshot: TaskGraphSnapshot = {
    tasks: filterTasksByPlan(allTasks, plan?.planId),
    goal: plan?.goal ?? null,
  };
  listener?.(snapshot);
  return { allTasks, snapshot };
}
