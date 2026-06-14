import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const listSlidesSchema = z.object({});

/**
 * Core Tool: 轻量列出页面 id、顺序和标题。
 * 用于定位页码、确认页数和解析“第 N 页”。
 * 不返回完整元素树，避免替代 ReadPresentationSnapshot。
 */
export const listSlidesTool: ToolDefinition<
  typeof listSlidesSchema,
  { slides: { id: string; index: number; title: string }[] }
> = {
  name: "ListSlides",
  description: "轻量列出所有幻灯片的基本信息，包括 ID、索引顺序和标题。",
  category: "core",
  loadPolicy: "core",
  inputSchema: listSlidesSchema,
  risk: "low",
  execute: async (_, context) => {
    const slides = context.presentation.slides.map((slide, index) => ({
      id: slide.id,
      index,
      title: slide.title,
    }));
    return { slides };
  },
};
