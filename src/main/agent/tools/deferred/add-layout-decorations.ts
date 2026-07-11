import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import { resolveSlideStyle } from "@design-system";
import { cardShadow, VISUAL_TOKENS } from "@shared/visual-tokens";

export const addLayoutDecorationsSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  mode: z
    .enum(["creative", "minimal"])
    .optional()
    .describe("creative 添加序号圆/分隔线；minimal 仅补缺失装饰"),
});

/**
 * Deferred Tool: 为 process/comparison/toc 页添加轻量装饰 shape。
 */
export const addLayoutDecorationsTool: ToolDefinition<
  typeof addLayoutDecorationsSchema,
  { commands: PresentationCommand[] }
> = {
  name: "AddLayoutDecorations",
  description: "按 layout 添加序号圆、分隔线、步骤箭头等创意装饰（process/comparison/toc）。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: addLayoutDecorationsSchema,
  risk: "medium",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) return { commands: [] };

    const colors = resolveSlideStyle(context.presentation.designSystem, slide).colors;
    const mode = args.mode ?? "creative";
    const commands: PresentationCommand[] = [];

    const hasShape = (prefix: string) =>
      slide.elements.some((el) => el.type === "shape" && el.id.startsWith(prefix));

    if (slide.layout === "comparison" && mode === "creative" && !hasShape("deco-divider-")) {
      commands.push({
        id: crypto.randomUUID(),
        type: "add-element",
        slideId: args.slideId,
        element: {
          id: `deco-divider-${crypto.randomUUID()}`,
          type: "shape",
          shapeType: "roundedRect",
          x: 628,
          y: 220,
          width: 8,
          height: 390,
          fillColor: colors.accent,
          strokeColor: colors.accent,
          cornerRadius: VISUAL_TOKENS.radii.pill,
          fillOpacity: 0.2,
          shadow: cardShadow("sm"),
        },
      });
    }

    if (slide.layout === "process" && mode === "creative") {
      const stepTexts = slide.elements.filter(
        (el) => el.type === "text" && el.textRole !== "caption",
      );
      stepTexts.slice(0, 4).forEach((_, idx) => {
        const prefix = `deco-step-${idx}-`;
        if (hasShape(prefix)) return;
        const colX = 120 + idx * (260 + 24);
        commands.push({
          id: crypto.randomUUID(),
          type: "add-element",
          slideId: args.slideId,
          element: {
            id: `${prefix}${crypto.randomUUID()}`,
            type: "shape",
            shapeType: "circle",
            x: colX + 8,
            y: 208,
            width: 28,
            height: 28,
            fillColor: colors.accent,
            strokeColor: colors.accent,
            shadow: cardShadow("sm"),
          },
        });
      });
    }

    if (slide.layout === "toc" && mode === "creative" && !hasShape("deco-toc-rule-")) {
      commands.push({
        id: crypto.randomUUID(),
        type: "add-element",
        slideId: args.slideId,
        element: {
          id: `deco-toc-rule-${crypto.randomUUID()}`,
          type: "shape",
          shapeType: "roundedRect",
          x: 168,
          y: 200,
          width: 4,
          height: 430,
          fillColor: colors.accent,
          strokeColor: colors.accent,
          cornerRadius: VISUAL_TOKENS.radii.pill,
          fillOpacity: 0.25,
        },
      });
    }

    return { commands };
  },
};
