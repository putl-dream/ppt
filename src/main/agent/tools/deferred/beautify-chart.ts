import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import { resolveSlideStyle } from "@design-system";

export const beautifyChartSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  elementId: z.string().describe("图表或 KPI 文本/图表元素 ID"),
});

/**
 * Deferred Tool: 对已有图表或 KPI 数字文本进行样式强化。
 */
export const beautifyChartTool: ToolDefinition<
  typeof beautifyChartSchema,
  { commands: PresentationCommand[] }
> = {
  name: "BeautifyChart",
  description: "美化已有 chart，或将明确的数值/KPI 文本强化为 metric 样式；不会从文本生成或推断图表数据。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: beautifyChartSchema,
  risk: "medium",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) throw new Error(`Slide '${args.slideId}' was not found.`);

    const element = slide.elements.find((item) => item.id === args.elementId);
    if (!element) {
      throw new Error(`Element '${args.elementId}' was not found on slide '${args.slideId}'.`);
    }

    const style = resolveSlideStyle(context.presentation.designSystem, slide);
    const colors = style.colors;

    if (element.type === "chart") {
      return {
        commands: [
          {
            id: crypto.randomUUID(),
            type: "update-element",
            slideId: args.slideId,
            elementId: args.elementId,
            element: { ...element, accentColor: colors.accent, chartStyle: style.chart.style },
          },
        ],
      };
    }

    if (element.type !== "text") {
      throw new Error("BeautifyChart only accepts an existing chart or KPI text element.");
    }

    const numericHint = /[\d%$¥€]/.test(element.text);
    if (!numericHint && element.textRole !== "metric") {
      throw new Error(
        "The selected text is not marked as a metric and contains no numeric value. "
        + "Provide structured chart data instead of inferring values from prose.",
      );
    }

    return {
      commands: [
        {
          id: crypto.randomUUID(),
          type: "update-text-style",
          slideId: args.slideId,
          elementId: args.elementId,
          textRole: "metric",
          bold: true,
          color: colors.accent,
          fontSize: Math.max(element.fontSize, 28),
        },
      ],
    };
  },
};
