import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import { SLIDE_VARIANTS } from "@shared/slide-variant";

export const updateSlideVariantSchema = z.object({
  slideId: z.string().describe("需要设置页级视觉节奏的幻灯片 ID"),
  slideVariant: z.enum(SLIDE_VARIANTS).describe("页级背景节奏：light / dark / hero"),
});

/**
 * Deferred Tool: 设置单页 slideVariant（light/dark/hero 背景节奏）。
 */
export const updateSlideVariantTool: ToolDefinition<
  typeof updateSlideVariantSchema,
  { commands: PresentationCommand[] }
> = {
  name: "UpdateSlideVariant",
  description: "设置单页 slideVariant（light/dark/hero），用于 cover/section 品牌页、正文浅色、强调深色等背景节奏。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: updateSlideVariantSchema,
  risk: "low",
  execute: async (args, context) => {
    if (!context.presentation.slides.some((slide) => slide.id === args.slideId)) {
      throw new Error(`Slide '${args.slideId}' was not found.`);
    }
    const commands: PresentationCommand[] = [
      {
        id: crypto.randomUUID(),
        type: "update-slide-variant",
        slideId: args.slideId,
        slideVariant: args.slideVariant,
      },
    ];
    return { commands };
  },
};
