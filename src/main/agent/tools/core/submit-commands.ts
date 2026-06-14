import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { presentationCommandSchema } from "@shared/commands";
import type { AgentRuntimeResult } from "../../runtime/runtime-types";

export const submitCommandsSchema = z.object({
  summary: z.string().describe("该方案的改动摘要说明"),
  commands: z.array(presentationCommandSchema).describe("要提交执行的命令列表"),
  risk: z.enum(["low", "medium", "high"]).default("low").describe("模型评估建议的风险等级"),
  assumptions: z.array(z.string()).optional().describe("模型生成修改方案时采用的假设条件"),
});

/**
 * Core Tool: 提交模型最终的命令方案。
 * 负责封装 summary、commands 和模型建议风险，形成 command_proposal 协议结果。
 * 不执行命令；系统风险策略可以覆盖模型声明的风险等级。
 */
export const submitCommandsTool: ToolDefinition<
  typeof submitCommandsSchema,
  AgentRuntimeResult
> = {
  name: "SubmitCommands",
  description:
    "基础 PPT 创建与编辑入口：可直接提交 add-slide、add-element、set-theme 等 PresentationCommand，"
    + "形成最终 Command Proposal 并进入系统校验关闸。基础创建无需搜索额外工具。",
  category: "core",
  loadPolicy: "core",
  inputSchema: submitCommandsSchema,
  risk: "low",
  execute: async (args) => {
    return {
      type: "command_proposal",
      summary: args.summary,
      commands: args.commands,
      risk: args.risk,
      assumptions: args.assumptions,
    };
  },
};
