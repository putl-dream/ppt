import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { DeckExportResult } from "@shared/ipc";
import { deckExportService } from "../../../deck/deck-export-service";

export const exportPptxSchema = z.object({
  format: z.enum(["pptx", "html", "pdf"]).default("pptx").describe("导出的文件格式"),
  run_in_background: z.boolean().optional().describe(
    "Run this export in the background; result returns later as task_notification.",
  ),
});

/**
 * Deferred Tool: 导出文件。
 * 执行大范围的非 PPT 编辑行为，需归入 deferred 并可能触发安全提示。
 */
export const exportPptxTool: ToolDefinition<
  typeof exportPptxSchema,
  DeckExportResult & { success: boolean }
> = {
  name: "ExportPptx",
  description: "将当前 PPT 文稿渲染并导出为外部格式（PPTX、HTML 或 PDF）文件。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: exportPptxSchema,
  risk: "medium",
  execute: async (args, context) => {
    if (args.format === "pdf") {
      throw new Error("PDF export is not supported yet; use format 'pptx' or 'html'.");
    }

    const presentation = context.presentation;
    const result = await deckExportService.exportDeck({
      presentation,
      options: {},
      format: args.format,
    });

    return {
      success: true,
      ...result,
    };
  },
};
