import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const exportPptxSchema = z.object({
  format: z.enum(["pptx", "pdf"]).default("pptx").describe("导出的文件格式"),
});

/**
 * Deferred Tool: 导出文件。
 * 执行大范围的非 PPT 编辑行为，需归入 deferred 并可能触发安全提示。
 */
export const exportPptxTool: ToolDefinition<
  typeof exportPptxSchema,
  { success: boolean; filePath: string }
> = {
  name: "ExportPptx",
  description: "将当前 PPT 文稿渲染并导出为外部格式（PPTX 或 PDF）文件。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: exportPptxSchema,
  risk: "medium",
  execute: async (args) => {
    return {
      success: true,
      filePath: `/mock/exports/presentation.${args.format}`,
    };
  },
};
