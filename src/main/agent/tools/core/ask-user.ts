import { z } from "zod";
import { agentQuestionInputSchema } from "@shared/agent-question";
import type { ToolDefinition } from "../tool-definition";
import {
  agentAskUserResultSchema,
  type AgentAskUserResult,
} from "../../runtime/runtime-types";

export const askUserSchema = z.object({
  message: z.string().describe("向用户提出的澄清问题内容"),
  missingFields: z.array(z.string()).optional().describe("阻止安全执行的具体缺失信息"),
  responseUi: agentQuestionInputSchema.optional().describe(
    "可选的回答界面配置对象，不是问题正文；必须直接传对象，禁止 JSON.stringify。",
  ),
});

/**
 * Core Tool: 在缺少必要信息或目标存在高影响歧义时请求用户补充。
 * 应先读取 PPT、当前页和选择上下文；能安全继续时不得滥用追问。
 * 本工具只结束当前 Runtime 回合，不保存或修改 Presentation。
 */
export const askUserTool: ToolDefinition<
  typeof askUserSchema,
  AgentAskUserResult
> = {
  name: "AskUser",
  description:
    "仅在缺少由用户决定的必要内容信息或指令存在高影响歧义时提问。"
    + "不得询问用户工具名、接口、环境能力或系统实现方式。",
  category: "core",
  loadPolicy: "core",
  inputSchema: askUserSchema,
  examples: [
    '{"message":"请选择内容侧重点","missingFields":["focus"],"responseUi":{"variant":"choices","options":[{"id":"theory","title":"理论框架"},{"id":"practice","title":"实践案例"}]}}',
    '{"message":"请补充目标受众","missingFields":["audience"],"responseUi":{"variant":"markdown","placeholder":"例如：企业管理者"}}',
  ],
  outputSchema: agentAskUserResultSchema,
  risk: "low",
  execute: async (args) => {
    const data = {
      content: args.message,
      ...(args.missingFields ? { missingFields: args.missingFields } : {}),
      ...(args.responseUi ? { question: args.responseUi } : {}),
    };
    return {
      type: "ask_user",
      ...data,
    };
  },
};
