import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const askUserSchema = z.object({
  message: z.string().describe("向用户提出的澄清问题内容"),
  missingFields: z.array(z.string()).optional().describe("阻止安全执行的具体缺失信息"),
});

/**
 * Core Tool: 在缺少必要信息或目标存在高影响歧义时请求用户补充。
 * 应先读取 PPT、当前页和选择上下文；能安全继续时不得滥用追问。
 * 本工具只结束当前 Runtime 回合，不保存或修改 Presentation。
 */
export const askUserTool: ToolDefinition<
  typeof askUserSchema,
  { type: "ask_user"; message: string; missingFields?: string[] }
> = {
  name: "AskUser",
  description: "在缺少必要信息或指令存在高度歧义时，向用户提问以作澄清。",
  category: "core",
  loadPolicy: "core",
  inputSchema: askUserSchema,
  risk: "low",
  execute: async (args) => {
    return {
      type: "ask_user",
      message: args.message,
      missingFields: args.missingFields,
    };
  },
};
