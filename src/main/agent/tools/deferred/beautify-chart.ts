import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import { getThemePaletteColors } from "@shared/layout";

export const beautifyChartSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  elementId: z.string().describe("图表或 KPI 文本元素 ID"),
});

/**
 * Deferred Tool: 对图表 / KPI 数字进行美化。
 */
export const beautifyChartTool: ToolDefinition<
  typeof beautifyChartSchema,
  { commands: PresentationCommand[] }
> = {
  name: "BeautifyChart",
  description: "强化 KPI / 指标数字的视觉展现（大字号、强调色、metric 角色）。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: beautifyChartSchema,
  risk: "medium",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) return { commands: [] };

    const element = slide.elements.find((item) => item.id === args.elementId);
    if (!element || element.type !== "text") return { commands: [] };

    const theme = context.presentation.theme || "nordic";
    const palette = context.presentation.palette || "cyan";
    const colors = getThemePaletteColors(theme, palette);
    const isMetricLayout = slide.layout === "case";
    const numericHint = /[\d%$¥€]/.test(element.text);

    if (!numericHint && element.textRole !== "metric" && !isMetricLayout) {
      return { commands: [] };
    }

    const commands: PresentationCommand[] = [
      {
        id: crypto.randomUUID(),
        type: "update-text-style",
        slideId: args.slideId,
        elementId: args.elementId,
        textRole: "metric",
        fontSize: 48,
        bold: true,
        color: colors.accent,
        align: "center",
      },
    ];

    return { commands };
  },
};
