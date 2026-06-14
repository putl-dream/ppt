import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const detectRepeatedTitlesSchema = z.object({});

/**
 * Deferred Tool: 检测幻灯片页面之间是否存在标题重复问题。
 */
export const detectRepeatedTitlesTool: ToolDefinition<
  typeof detectRepeatedTitlesSchema,
  { repeated: Array<{ title: string; slideIds: string[] }> }
> = {
  name: "DetectRepeatedTitles",
  description: "检查演示文稿中是否存在完全重复的幻灯片标题。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: detectRepeatedTitlesSchema,
  risk: "low",
  execute: async (_, context) => {
    const titleMap = new Map<string, string[]>();
    for (const slide of context.presentation.slides) {
      if (slide.title) {
        const list = titleMap.get(slide.title) || [];
        list.push(slide.id);
        titleMap.set(slide.title, list);
      }
    }

    const repeated: Array<{ title: string; slideIds: string[] }> = [];
    for (const [title, ids] of titleMap.entries()) {
      if (ids.length > 1) {
        repeated.push({ title, slideIds: ids });
      }
    }

    return { repeated };
  },
};
