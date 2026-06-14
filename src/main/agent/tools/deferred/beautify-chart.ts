import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";

export const beautifyChartSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  elementId: z.string().describe("图表元素 ID"),
});

/**
 * Deferred Tool: 对图表进行美化。
 */
export const beautifyChartTool: ToolDefinition<
  typeof beautifyChartSchema,
  { commands: PresentationCommand[] }
> = {
  name: "BeautifyChart",
  description: "优化图表元素的视觉展现（色彩搭配、网格对齐、图例排布等）。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: beautifyChartSchema,
  risk: "medium",
  execute: async () => {
    // 骨架返回：空操作指令数组
    return { commands: [] };
  },
};
