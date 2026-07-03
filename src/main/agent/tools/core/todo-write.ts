import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import {
  agentTodoItemSchema,
  applyTodoUpdate,
  summarizeTodoProgress,
  type AgentTodoItem,
} from "@shared/agent-todo";

export const todoWriteSchema = z.object({
  merge: z.boolean().describe(
    "false 时替换整个列表；true 时按 id 合并更新已有项并追加新项",
  ),
  todos: z.array(agentTodoItemSchema).min(1).describe("任务列表，每项含 id、content、status"),
});

export type TodoWriteResult = {
  todos: AgentTodoItem[];
  summary: string;
};

/**
 * Core Tool: 仅用于规划与进度跟踪，不读文件、不跑命令、不修改 PPT。
 * Agent 应在动手前先列出步骤，每完成一步更新状态。
 */
export const todoWriteTool: ToolDefinition<typeof todoWriteSchema, TodoWriteResult> = {
  name: "TodoWrite",
  description:
    "维护当前任务的步骤计划与进度。不执行任何实际操作（不读文件、不跑命令、不改幻灯片）。"
    + "收到复杂任务后，先用 merge=false 列出全部步骤（pending）；"
    + "开始某步时标 in_progress，完成后标 completed。"
    + "用 merge=true 增量更新。保持计划与用户最初目标对齐。",
  category: "core",
  loadPolicy: "core",
  inputSchema: todoWriteSchema,
  risk: "low",
  execute: async (args, context) => {
    if (!context.todoSession) {
      throw new Error("Todo session is not available.");
    }

    const todos = context.todoSession.applyUpdate(args.merge, args.todos);
    context.notifyTodoUpdated?.(todos);

    return {
      todos,
      summary: summarizeTodoProgress(todos),
    };
  },
};
