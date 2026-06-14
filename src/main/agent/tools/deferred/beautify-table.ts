import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";

export const beautifyTableSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  elementId: z.string().describe("表格元素 ID"),
});

/**
 * Deferred Tool: 对表格进行美化。
 */
export const beautifyTableTool: ToolDefinition<
  typeof beautifyTableSchema,
  { commands: PresentationCommand[] }
> = {
  name: "BeautifyTable",
  description: "美化表格视觉风格，如斑马线色彩、行高、文字对齐和边框调整。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: beautifyTableSchema,
  risk: "medium",
  execute: async () => {
    return { commands: [] };
  },
};
