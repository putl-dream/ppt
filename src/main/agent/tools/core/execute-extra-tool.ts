import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { validateToolOutput } from "../tool-validation";

export const executeExtraToolSchema = z.object({
  toolName: z.string().describe("需要执行的目标延迟工具（Deferred Tool）的名称"),
  toolArgs: z.record(z.string(), z.any()).describe("传递给延迟工具的参数对象"),
  run_in_background: z.boolean().optional().describe(
    "Run a slow eligible deferred tool in the background; result returns later as task_notification.",
  ),
});

/**
 * Core Tool: 执行已发现且通过 schema/权限检查的 Deferred Tool。
 * 必须拒绝 core、runtime、disabled、未知和未经授权的工具；高风险能力只返回审批要求。
 * 调用前必须确认 toolName 存在于当前 thread 的 ToolDiscoverySession.discoveredToolNames；
 * 仅知道或猜中工具名称不构成执行权限，其他会话中的发现记录也无效。
 * 工具输出仍是分析结果或候选 commands，不能借此直接写入真实 PPT。
 */
export const executeExtraToolTool: ToolDefinition<typeof executeExtraToolSchema, any> = {
  name: "ExecuteExtraTool",
  description: "执行此前已发现的延迟工具（Deferred Tool）。",
  category: "core",
  loadPolicy: "core",
  inputSchema: executeExtraToolSchema,
  risk: "low",
  execute: async (args, context) => {
    // 权限校验不变量：必须已被发现
    if (!context.discoverySession.discoveredToolNames.has(args.toolName)) {
      throw new Error(
        `Permission denied: Tool '${args.toolName}' has not been discovered in the current session. ` +
        `You must call SearchExtraTools to discover it first before execution.`
      );
    }

    const tool = context.registry.get(args.toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${args.toolName}`);
    }
    if (tool.category !== "deferred" || tool.loadPolicy !== "deferred") {
      throw new Error(`Tool '${args.toolName}' is not an executable Deferred Tool.`);
    }

    const parsed = tool.inputSchema.safeParse(args.toolArgs);
    if (!parsed.success) {
      throw new Error(`Invalid arguments for '${args.toolName}': ${parsed.error.message}`);
    }

    const result = validateToolOutput(
      tool,
      await tool.execute(parsed.data, context),
    );

    return {
      toolName: args.toolName,
      risk: tool.risk,
      result,
    };
  },
};
