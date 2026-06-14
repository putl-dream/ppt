import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";

export const autoLayoutSlideSchema = z.object({
  slideId: z.string().describe("需要重排版幻灯片的 ID"),
  layout: z.enum(["cover", "section", "concept", "comparison", "process", "architecture", "case", "summary"]).describe("目标版式名称"),
});

/**
 * Deferred Tool: 对单页 Slide 进行自动美化排版。
 */
export const autoLayoutSlideTool: ToolDefinition<
  typeof autoLayoutSlideSchema,
  { commands: PresentationCommand[] }
> = {
  name: "AutoLayoutSlide",
  description: "根据指定的精美版式结构，对单页幻灯片进行元素重排版和对齐。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: autoLayoutSlideSchema,
  risk: "medium",
  execute: async (args) => {
    const commands: PresentationCommand[] = [
      {
        id: crypto.randomUUID(),
        type: "update-slide-layout",
        slideId: args.slideId,
        layout: args.layout,
      },
    ];
    return { commands };
  },
};
