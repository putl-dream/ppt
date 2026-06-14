import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const compressTextSchema = z.object({
  text: z.string().describe("需要压缩的长文本内容"),
  maxLength: z.number().describe("期望的压缩后最大字数"),
});

/**
 * Deferred Tool: 文本压缩与精简。
 * 用于将冗长的段落提炼为适合幻灯片展示的短语，保持核心事实与语义。
 */
export const compressTextTool: ToolDefinition<
  typeof compressTextSchema,
  { compressedText: string }
> = {
  name: "CompressText",
  description: "精简和压缩长文本，使其更符合幻灯片的简洁展示原则，同时保持其语义。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: compressTextSchema,
  risk: "low",
  execute: async (args) => {
    // 骨架逻辑：若文字超长，返回截断版本并加省略号
    const text = args.text;
    const limit = args.maxLength;
    const compressedText = text.length <= limit ? text : text.substring(0, limit) + "...";
    return { compressedText };
  },
};
