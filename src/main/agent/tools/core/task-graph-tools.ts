import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../tool-definition";
import {
  agentTaskExecutionTargetSchema,
  formatTaskListSummary,
  summarizeTaskGraphProgress,
  type AgentTaskNode,
} from "@shared/agent-task-graph";
import type { TaskStore } from "../../task/task-store";

function requireTaskStore(context: { taskStore?: TaskStore }): TaskStore {
  if (!context.taskStore) {
    throw new Error("Task graph store is not available (workspace root required).");
  }
  return context.taskStore;
}

async function publishTaskGraph(
  context: {
    taskStore?: TaskStore;
    notifyTaskGraphUpdated?: (input: { tasks: AgentTaskNode[]; goal?: string | null }) => void;
  },
  store: TaskStore,
): Promise<AgentTaskNode[]> {
  const tasks = await store.listTasks();
  const plan = await store.getPlanMeta();
  context.notifyTaskGraphUpdated?.({ tasks, goal: plan?.goal ?? null });
  return tasks;
}

const blockedBySchema = z.array(z.string()).optional().describe("依赖的任务 ID；全部 completed 后才能 claim");

export const taskGraphCreateSchema = z.object({
  subject: z.string().min(1).describe("任务标题"),
  description: z.string().optional().describe("详细说明，跨会话恢复时供 Agent 阅读"),
  blockedBy: blockedBySchema,
  executionTarget: agentTaskExecutionTargetSchema.optional().describe(
    "执行目标：workspace 产物用 teammate；仅 lead/core tool 能执行的步骤用 lead",
  ),
});

export const taskGraphCreatePlanSchema = z.object({
  goal: z.string().optional().describe("整体目标，展示在 UI 计划卡片"),
  steps: z.array(z.object({
    subject: z.string().min(1),
    description: z.string().optional(),
    blockedBy: blockedBySchema,
    executionTarget: agentTaskExecutionTargetSchema.describe(
      "执行目标：workspace 产物用 teammate；SubmitCommands/ExecuteLayoutPlan/用户决策用 lead",
    ),
  })).min(1).describe("计划步骤列表"),
  sequential: z.boolean().optional().describe("true 时自动将每步 blockedBy 设为前一步（形成链式 DAG）"),
});

export const taskGraphListSchema = z.object({});

export const taskGraphGetSchema = z.object({
  taskId: z.string().min(1).describe("任务 ID"),
});

export const taskGraphClaimSchema = z.object({
  taskId: z.string().min(1).describe("要认领的任务 ID"),
  owner: z.string().optional().describe("认领者标识（lead / 伙伴名）；默认 agent"),
});

export const taskGraphCompleteSchema = z.object({
  taskId: z.string().min(1).describe("要完成的任务 ID"),
});

export type TaskGraphCreateResult = { task: AgentTaskNode; summary: string; tasks: AgentTaskNode[] };
export type TaskGraphCreatePlanResult = {
  planId: string;
  goal?: string;
  tasks: AgentTaskNode[];
  summary: string;
};
export type TaskGraphListResult = { tasks: AgentTaskNode[]; summary: string; goal?: string | null };
export type TaskGraphGetResult = { task: AgentTaskNode };
export type TaskGraphClaimResult = { message: string; task: AgentTaskNode; tasks: AgentTaskNode[] };
export type TaskGraphCompleteResult = {
  message: string;
  task: AgentTaskNode;
  unblocked: string[];
  tasks: AgentTaskNode[];
};

function ensureAutonomousTaskWorker(
  context: ToolContext,
  tasks: AgentTaskNode[],
): string | undefined {
  if (!tasks.some((task) => task.executionTarget === "teammate")) return undefined;
  if (!context.teammateManager || !context.workspaceRoot || !context.gateway) return undefined;

  const existing = context.teammateManager.list().find(
    (teammate) => teammate.name === "task_worker"
      && (teammate.status === "running" || teammate.status === "idle"),
  );
  if (existing) return existing.name;

  return context.teammateManager.spawn({
    name: "task_worker",
    role: "autonomous PPT workspace task worker",
    prompt: "Poll the shared task board and execute eligible teammate tasks.",
    startIdle: true,
    workspaceRoot: context.workspaceRoot,
    gateway: context.gateway,
    model: context.model,
    agentStepLimits: context.agentStepLimits,
    idleTimeoutMs: 300_000,
  }).name;
}

/**
 * 持久化任务图：唯一任务规划系统。teammate 节点自主认领并提交；lead 验收或自执行后完成。
 * 禁止平面改写状态，避免 lead + 伙伴重复认领。
 */
export const taskGraphCreateTool: ToolDefinition<typeof taskGraphCreateSchema, TaskGraphCreateResult> = {
  name: "TaskGraphCreate",
  description:
    "创建单个持久化任务节点（.tasks/{id}.json）。用 blockedBy 声明 DAG 依赖。"
    + "teammate 节点会由常驻 worker 自动认领；lead 节点需主 Agent 手动认领。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphCreateSchema,
  risk: "low",
  execute: async (args, context) => {
    const store = requireTaskStore(context);
    const result = await store.createTask(args);
    if (!result.ok) throw new Error(result.error);
    const worker = ensureAutonomousTaskWorker(context, [result.task]);
    const tasks = await publishTaskGraph(context, store);
    return {
      task: result.task,
      tasks,
      summary: `Created ${result.task.id}: ${result.task.subject}`
        + (worker ? ` · autonomous worker: ${worker}` : ""),
    };
  },
};

export const taskGraphCreatePlanTool: ToolDefinition<
  typeof taskGraphCreatePlanSchema,
  TaskGraphCreatePlanResult
> = {
  name: "TaskGraphCreatePlan",
  description:
    "批量创建计划步骤（可 sequential 串依赖）。多阶段任务（≥3 步）或 lead 分工场景优先用此工具。"
    + "teammate 步骤由常驻 worker 自动认领并提交验收；lead 步骤由 lead Claim → 执行 → Complete。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphCreatePlanSchema,
  risk: "low",
  execute: async (args, context) => {
    const store = requireTaskStore(context);
    const result = await store.createPlan(args);
    if (!result.ok) throw new Error(result.error);
    const worker = ensureAutonomousTaskWorker(context, result.tasks);
    const tasks = await publishTaskGraph(context, store);
    return {
      planId: result.planId,
      goal: result.goal,
      tasks,
      summary: `Created plan ${result.planId} · ${result.tasks.length} tasks · ${summarizeTaskGraphProgress(tasks)}`
        + (worker ? ` · autonomous worker: ${worker}` : ""),
    };
  },
};

export const taskGraphListTool: ToolDefinition<typeof taskGraphListSchema, TaskGraphListResult> = {
  name: "TaskGraphList",
  description: "列出 .tasks/ 下全部持久化任务摘要（status、executionTarget、owner、blockedBy）。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphListSchema,
  risk: "low",
  execute: async (_args, context) => {
    const store = requireTaskStore(context);
    const tasks = await publishTaskGraph(context, store);
    const plan = await store.getPlanMeta();
    return { tasks, goal: plan?.goal ?? null, summary: formatTaskListSummary(tasks) };
  },
};

export const taskGraphGetTool: ToolDefinition<typeof taskGraphGetSchema, TaskGraphGetResult> = {
  name: "TaskGraphGet",
  description: "读取单个任务的完整 JSON（含 description 与依赖），用于跨会话恢复。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphGetSchema,
  risk: "low",
  execute: async (args, context) => {
    const store = requireTaskStore(context);
    const task = await store.getTask(args.taskId);
    return { task };
  },
};

export const taskGraphClaimTool: ToolDefinition<typeof taskGraphClaimSchema, TaskGraphClaimResult> = {
  name: "TaskGraphClaim",
  description:
    "认领任务：blockedBy 全部 completed 后 pending → in_progress 并设置 owner。"
    + "主 Agent 只用它认领 executionTarget=lead 的节点；teammate 节点由 worker 自动认领。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphClaimSchema,
  risk: "low",
  execute: async (args, context) => {
    const store = requireTaskStore(context);
    const owner = args.owner ?? context.taskGraphOwner ?? "agent";
    const task = await store.getTask(args.taskId);
    if (task.executionTarget === "teammate") {
      throw new Error(
        `Task ${args.taskId} targets teammate execution and must remain unowned for autonomous claim.`,
      );
    }
    const result = await store.claimTask(args.taskId, owner);
    if (!result.ok) throw new Error(result.error);
    const tasks = await publishTaskGraph(context, store);
    return { message: result.message, task: result.task, tasks };
  },
};

export const taskGraphCompleteTool: ToolDefinition<typeof taskGraphCompleteSchema, TaskGraphCompleteResult> = {
  name: "TaskGraphComplete",
  description:
    "验收并完成任务：lead 自执行任务可从 in_progress 完成；teammate 提交任务从 submitted 完成，随后解锁下游。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphCompleteSchema,
  risk: "low",
  execute: async (args, context) => {
    const store = requireTaskStore(context);
    const result = await store.completeTask(args.taskId);
    if (!result.ok) throw new Error(result.error);
    const tasks = await publishTaskGraph(context, store);
    return {
      message: result.message,
      task: result.task,
      unblocked: result.unblocked,
      tasks,
    };
  },
};

export const taskGraphTools = [
  taskGraphCreateTool,
  taskGraphCreatePlanTool,
  taskGraphListTool,
  taskGraphGetTool,
  taskGraphClaimTool,
  taskGraphCompleteTool,
] as const;

export const TASK_GRAPH_TOOL_NAMES = new Set(taskGraphTools.map((tool) => tool.name));
