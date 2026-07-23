import { z } from "zod";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import type { TaskStore } from "../task/task-store";
import type { SubAgentToolDefinition } from "../subagent/workspace-tools";
import type { ToolPermissionProfile } from "../runtime/tools/tool-access-policy";
import {
  publishCurrentTaskGraph,
  type TaskGraphSnapshotListener,
} from "../task/task-graph-publisher";

const emptySchema = z.object({});
const taskIdSchema = z.object({
  task_id: z.string().trim().min(1).describe("Persistent task ID from the .tasks board"),
});

const TASK_TOOL_PERMISSION: ToolPermissionProfile = {
  profile: "teammate-task-board",
  description: "Read or update the shared persistent task board.",
  scopes: ["subagent"],
  effects: ["workflow.delegate"],
  sandbox: "workspace",
  approval: "never",
};

export function createTeammateTaskTools(
  store: TaskStore,
  owner: string,
  onTaskGraphUpdated?: TaskGraphSnapshotListener,
): SubAgentToolDefinition[] {
  const scanTool: SubAgentToolDefinition<typeof emptySchema> = {
    name: "scan_unclaimed_tasks",
    description:
      "List pending, unowned tasks whose blockedBy dependencies are all completed. Idle mode also calls this automatically.",
    inputSchema: emptySchema,
    permission: TASK_TOOL_PERMISSION,
    async execute() {
      return JSON.stringify(await store.scanUnclaimedTasks(), null, 2);
    },
  };

  const claimTool: SubAgentToolDefinition<typeof taskIdSchema> = {
    name: "claim_task",
    description:
      "Atomically claim a startable task for yourself. Idle mode normally does this automatically.",
    inputSchema: taskIdSchema,
    permission: TASK_TOOL_PERMISSION,
    async execute(args) {
      const result = await store.claimTask(args.task_id, owner);
      if (!result.ok) throw new Error(result.error);
      await publishCurrentTaskGraph(store, onTaskGraphUpdated);
      return formatTaskResult(result.message, result.task);
    },
  };

  const submitTool: SubAgentToolDefinition<typeof taskIdSchema> = {
    name: "submit_task",
    description:
      "Submit a task you own for lead review after concrete work is finished. Submission does not unlock dependencies.",
    inputSchema: taskIdSchema,
    permission: TASK_TOOL_PERMISSION,
    async execute(args) {
      const result = await store.submitTask(args.task_id, owner);
      if (!result.ok) throw new Error(result.error);
      await publishCurrentTaskGraph(store, onTaskGraphUpdated);
      return formatTaskResult(result.message, result.task);
    },
  };

  return [scanTool, claimTool, submitTool];
}

export async function claimNextUnclaimedTask(
  store: TaskStore,
  owner: string,
  onTaskGraphUpdated?: TaskGraphSnapshotListener,
): Promise<AgentTaskNode | undefined> {
  const candidates = await store.scanUnclaimedTasks();
  for (const candidate of candidates) {
    const result = await store.claimTask(candidate.id, owner);
    if (result.ok) {
      await publishCurrentTaskGraph(store, onTaskGraphUpdated);
      return result.task;
    }
  }
  return undefined;
}

export async function unassignOwnedTasks(
  store: TaskStore,
  owner: string,
  onTaskGraphUpdated?: TaskGraphSnapshotListener,
): Promise<string[]> {
  const released = await store.unassignInProgressByOwner(owner);
  if (released.length > 0) {
    await publishCurrentTaskGraph(store, onTaskGraphUpdated);
  }
  return released;
}

function formatTaskResult(
  message: string,
  task: AgentTaskNode,
  unblocked: string[] = [],
): string {
  return JSON.stringify({ message, task, unblocked }, null, 2);
}
