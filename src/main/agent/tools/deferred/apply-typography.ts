import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import { resolveFontFamily, type TextRole } from "@shared/typography";
import type { SlideLayoutType } from "@shared/slide-layouts";

export const applyTypographySchema = z.object({
  slideId: z.string().optional().describe("可选：仅处理单页；省略则处理全 deck"),
  reapplyLayout: z
    .boolean()
    .optional()
    .describe("是否在字体更新后重新执行 update-slide-layout"),
});

/**
 * Deferred Tool: 按 theme + textRole 批量更新字体角色。
 */
export const applyTypographyTool: ToolDefinition<
  typeof applyTypographySchema,
  { commands: PresentationCommand[] }
> = {
  name: "ApplyTypography",
  description: "按当前 theme 与 textRole 批量更新文本 fontFamily 与 metric 样式。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: applyTypographySchema,
  risk: "medium",
  execute: async (args, context) => {
    const theme = context.presentation.theme || "nordic";
    const commands: PresentationCommand[] = [];
    const slides = args.slideId
      ? context.presentation.slides.filter((slide) => slide.id === args.slideId)
      : context.presentation.slides;

    for (const slide of slides) {
      for (const element of slide.elements) {
        if (element.type !== "text") continue;

        const role = (element.textRole ?? "body") as TextRole;
        const fontFamily = resolveFontFamily(element.fontFamily, role, theme);

        if (element.fontFamily === fontFamily && role === element.textRole) continue;

        commands.push({
          id: crypto.randomUUID(),
          type: "update-text-style",
          slideId: slide.id,
          elementId: element.id,
          textRole: role,
          fontFamily,
        });
      }

      if (args.reapplyLayout && slide.layout) {
        commands.push({
          id: crypto.randomUUID(),
          type: "update-slide-layout",
          slideId: slide.id,
          layout: slide.layout as SlideLayoutType,
        });
      }
    }

    return { commands };
  },
};
