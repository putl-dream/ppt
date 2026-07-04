import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import { getThemePaletteColors } from "@shared/layout";

export const beautifyChartSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  elementId: z.string().describe("图表或 KPI 文本/图表元素 ID"),
});

/**
 * Deferred Tool: 对图表 / KPI 数字进行美化，或创建 chart 元素。
 */
export const beautifyChartTool: ToolDefinition<
  typeof beautifyChartSchema,
  { commands: PresentationCommand[] }
> = {
  name: "BeautifyChart",
  description: "强化 KPI / 指标数字的视觉展现，或将文本指标转为 chart 元素（kpi-tower / bar）。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: beautifyChartSchema,
  risk: "medium",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) return { commands: [] };

    const element = slide.elements.find((item) => item.id === args.elementId);
    if (!element) return { commands: [] };

    const theme = context.presentation.theme || "nordic";
    const palette = context.presentation.palette || "cyan";
    const colors = getThemePaletteColors(theme, palette);

    if (element.type === "chart") {
      return {
        commands: [
          {
            id: crypto.randomUUID(),
            type: "update-element",
            slideId: args.slideId,
            elementId: args.elementId,
            element: { ...element, accentColor: colors.accent },
          },
        ],
      };
    }

    if (element.type !== "text") return { commands: [] };

    const isMetricLayout = slide.layout === "case";
    const numericHint = /[\d%$¥€]/.test(element.text);

    if (!numericHint && element.textRole !== "metric" && !isMetricLayout) {
      return { commands: [] };
    }

    const parsedValue = parseFloat(element.text.replace(/[^\d.]/g, ""));
    const chartType = isMetricLayout ? "kpi-tower" : "bar";

    return {
      commands: [
        {
          id: crypto.randomUUID(),
          type: "remove-element",
          slideId: args.slideId,
          elementId: args.elementId,
        },
        {
          id: crypto.randomUUID(),
          type: "add-element",
          slideId: args.slideId,
          element: {
            id: crypto.randomUUID(),
            type: "chart",
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            chartType,
            data: {
              items: [{ label: element.text, value: Number.isFinite(parsedValue) ? parsedValue : 100 }],
            },
            accentColor: colors.accent,
          },
        },
      ],
    };
  },
};
