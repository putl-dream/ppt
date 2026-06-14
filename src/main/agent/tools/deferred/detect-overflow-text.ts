import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const detectOverflowTextSchema = z.object({
  slideId: z.string().optional().describe("指定检查的幻灯片 ID，若为空则检查整套 PPT"),
});

/**
 * Deferred Tool: 检查幻灯片中是否存在文本框内容溢出。
 */
export const detectOverflowTextTool: ToolDefinition<
  typeof detectOverflowTextSchema,
  { overflowElements: Array<{ slideId: string; elementId: string; currentLength: number }> }
> = {
  name: "DetectOverflowText",
  description: "检查指定幻灯片或全局文本框是否存在文字过多导致视觉溢出的情况。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: detectOverflowTextSchema,
  risk: "low",
  execute: async (args, context) => {
    const overflowElements: Array<{ slideId: string; elementId: string; currentLength: number }> = [];
    const targetSlides = args.slideId
      ? context.presentation.slides.filter((s) => s.id === args.slideId)
      : context.presentation.slides;

    for (const slide of targetSlides) {
      for (const el of slide.elements) {
        if (el.type === "text" && el.text.length > 200) {
          overflowElements.push({
            slideId: slide.id,
            elementId: el.id,
            currentLength: el.text.length,
          });
        }
      }
    }

    return { overflowElements };
  },
};
