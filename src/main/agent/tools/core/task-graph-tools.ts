import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import {
  formatTaskListSummary,
  type AgentTaskNode,
} from "@shared/agent-task-graph";
import type { TaskStore } from "../../task/task-store";

function requireTaskStore(context: { taskStore?: TaskStore }): TaskStore {
  if (!context.taskStore) {
    throw new Error("Task graph store is not available (workspace root required).");
  }
  return context.taskStore;
}

const blockedBySchema = z.array(z.string()).optional().describe("依赖的任务 ID 列表；全部 completed 后才能 claim");

export const taskGraphCreateSchema = z.object({
  subject: z.string().min(1).describe("任务标题"),
  description: z.string().optional().describe("详细说明，跨会话恢复时供 Agent 阅读"),
  blockedBy: blockedBySchema,
});

export const taskGraphListSchema = z.object({});

export const taskGraphGetSchema = z.object({
  taskId: z.string().min(1).describe("任务 ID"),
});

export const taskGraphClaimSchema = z.object({
  taskId: z.string().min(1).describe("要认领的任务 ID"),
  owner: z.string().optional().describe("认领者标识，默认 agent"),
});

export const taskGraphCompleteSchema = z.object({
  taskId: z.string().min(1).describe("要完成的任务 ID"),
});

export type TaskGraphCreateResult = { task: AgentTaskNode; summary: string };
export type TaskGraphListResult = { tasks: AgentTaskNode[]; summary: string };
export type TaskGraphGetResult = { task: AgentTaskNode };
export type TaskGraphClaimResult = { message: string; task: AgentTaskNode };
export type TaskGraphCompleteResult = { message: string; task: AgentTaskNode; unblocked: string[] };

/**
 * 持久化任务图工具：大目标拆成小任务、声明依赖、跨会话可恢复。
 * 与 TodoWrite（会话内平面步骤）和 Task（子 Agent 委派）分工不同。
 */
export const taskGraphCreateTool: ToolDefinition<typeof taskGraphCreateSchema, TaskGraphCreateResult> = {
  name: "TaskGraphCreate",
  description:
    "创建持久化任务节点，写入 workspace/.tasks/{id}.json。"
    + "用 blockedBy 声明 DAG 依赖（如写 API 依赖 schema 任务）。"
    + "复杂多阶段目标、需跨会话恢复时用 TaskGraph；当前会话内的平面步骤仍用 TodoWrite。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphCreateSchema,
  risk: "low",
  execute: async (args, context) => {
    const store = requireTaskStore(context);
    const result = await store.createTask(args);
    if (!result.ok) throw new Error(result.error);
    return {
      task: result.task,
      summary: `Created ${result.task.id}: ${result.task.subject}`,
    };
  },
};

export const taskGraphListTool: ToolDefinition<typeof taskGraphListSchema, TaskGraphListResult> = {
  name: "TaskGraphList",
  description: "列出 workspace/.tasks/ 下全部持久化任务的一行摘要（含 status、owner、blockedBy）。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphListSchema,
  risk: "low",
  execute: async (_args, context) => {
    const store = requireTaskStore(context);
    const tasks = await store.listTasks();
    return { tasks, summary: formatTaskListSummary(tasks) };
  },
};

export const taskGraphGetTool: ToolDefinition<typeof taskGraphGetSchema, TaskGraphGetResult> = {
  name: "TaskGraphGet",
  description: "读取单个持久化任务的完整 JSON（含 description 与依赖），用于跨会话恢复上下文。",
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
    "认领持久化任务：blockedBy 全部 completed 后，pending → in_progress 并设置 owner。"
    + "依赖未满足或已被认领时拒绝。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphClaimSchema,
  risk: "low",
  execute: async (args, context) => {
    const store = requireTaskStore(context);
    const owner = args.owner ?? context.taskGraphOwner ?? "agent";
    const result = await store.claimTask(args.taskId, owner);
    if (!result.ok) throw new Error(result.error);
    return { message: result.message, task: result.task };
  },
};

export const taskGraphCompleteTool: ToolDefinition<typeof taskGraphCompleteSchema, TaskGraphCompleteResult> = {
  name: "TaskGraphComplete",
  description:
    "完成 in_progress 任务：标记 completed 并返回刚被解锁的下游 pending 任务标题。",
  category: "core",
  loadPolicy: "core",
  inputSchema: taskGraphCompleteSchema,
  risk: "low",
  execute: async (args, context) => {
    const store = requireTaskStore(context);
    const result = await store.completeTask(args.taskId);
    if (!result.ok) throw new Error(result.error);
    return {
      message: result.message,
      task: result.task,
      unblocked: result.unblocked,
    };
  },
};

export const taskGraphTools = [
  taskGraphCreateTool,
  taskGraphListTool,
  taskGraphGetTool,
  taskGraphClaimTool,
  taskGraphCompleteTool,
] as const;
