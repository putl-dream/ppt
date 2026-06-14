import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";

export const rewriteSlideContentSchema = z.object({
  slideId: z.string().describe("目标幻灯片 ID"),
  elementId: z.string().describe("目标文本框元素 ID"),
  style: z.enum(["professional", "concise", "creative", "persuasive"]).describe("修改文风风格"),
});

/**
 * Deferred Tool: 文本改写。
 * 与“只美化、保持事实”的布局工具不同，该工具明确允许模型根据风格改写文字内容。
 */
export const rewriteSlideContentTool: ToolDefinition<
  typeof rewriteSlideContentSchema,
  { commands: PresentationCommand[] }
> = {
  name: "RewriteSlideContent",
  description: "根据所选风格（专业、简洁、创意、说服性）改写特定文本框的内容。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: rewriteSlideContentSchema,
  risk: "medium",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((s) => s.id === args.slideId);
    const element = slide?.elements.find((el) => el.id === args.elementId);
    
    if (!element || element.type !== "text") {
      throw new Error(`Text element '${args.elementId}' not found on slide '${args.slideId}'.`);
    }

    const mockRewrites: Record<string, string> = {
      professional: `[专业版] ${element.text}`,
      concise: `[精炼版] ${element.text.slice(0, 30)}`,
      creative: `[创意版] Sparking: ${element.text}`,
      persuasive: `[说服性版] Key Value: ${element.text}`,
    };

    const rewrittenText = mockRewrites[args.style] || element.text;

    const commands: PresentationCommand[] = [
      {
        id: crypto.randomUUID(),
        type: "update-element",
        slideId: args.slideId,
        elementId: args.elementId,
        element: {
          ...element,
          text: rewrittenText,
        },
      },
    ];

    return { commands };
  },
};
