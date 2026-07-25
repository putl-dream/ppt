import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { Slide } from "@shared/presentation";

export const readCurrentSlideSchema = z.object({});

/**
 * Core Tool: 读取当前编辑页的元素、位置和样式摘要。
 * 用于“这一页”“当前页”“这里”等局部请求。
 * 只读；当前页来源应由编辑器/session 上下文提供，不能由模型猜测。
 */
export const readCurrentSlideTool: ToolDefinition<
  typeof readCurrentSlideSchema,
  { slide: Slide | null }
> = {
  name: "ReadCurrentSlide",
  description: "获取当前编辑的幻灯片页面的完整结构与元素列表。",
  category: "core",
  loadPolicy: "core",
  inputSchema: readCurrentSlideSchema,
  mapResultToModelContent: (result) => {
    const slide = result.slide;
    if (!slide) return JSON.stringify({ slide: null });
    if (slide.visualSource?.kind !== "svg") return JSON.stringify(result);
    return JSON.stringify({
      slide: {
        id: slide.id,
        title: slide.title,
        speakerNotes: slide.speakerNotes,
        narrative: slide.narrative,
        visualSource: {
          kind: "svg",
          sourcePath: slide.visualSource.sourcePath,
          sha256: slide.visualSource.sha256,
          width: slide.visualSource.width,
          height: slide.visualSource.height,
          resourceCount: slide.visualSource.resources.length,
        },
        readInstruction: `Use ReadFile("${slide.visualSource.sourcePath}") to inspect or edit the complete SVG page.`,
      },
    });
  },
  risk: "low",
  execute: async (_, context) => {
    if (!context.currentSlideId) {
      return { slide: null };
    }
    const slide = context.presentation.slides.find((s) => s.id === context.currentSlideId) || null;
    return { slide };
  },
};
