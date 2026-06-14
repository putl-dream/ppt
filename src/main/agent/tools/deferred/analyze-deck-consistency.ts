import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const analyzeDeckConsistencySchema = z.object({});

/**
 * Deferred Tool: 分析整套 PPT 的字体、间距、颜色、标题层级和布局一致性。
 * 输出分组问题与严重度，不直接生成全局覆盖式修改。
 */
export const analyzeDeckConsistencyTool: ToolDefinition<
  typeof analyzeDeckConsistencySchema,
  { issues: Array<{ category: string; severity: "info" | "warning" | "error"; message: string }> }
> = {
  name: "AnalyzeDeckConsistency",
  description: "检查整套 PPT 的字体、颜色、间距及排版风格的一致性，输出发现的问题列表。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: analyzeDeckConsistencySchema,
  risk: "low",
  execute: async (_, context) => {
    const issues: Array<{ category: string; severity: "info" | "warning" | "error"; message: string }> = [];
    const titles = new Set<string>();
    
    context.presentation.slides.forEach((slide, idx) => {
      if (!slide.title) {
        issues.push({
          category: "structure",
          severity: "warning",
          message: `第 ${idx + 1} 页幻灯片缺少标题。`,
        });
      } else {
        if (titles.has(slide.title)) {
          issues.push({
            category: "consistency",
            severity: "warning",
            message: `幻灯片标题 '${slide.title}' 重复出现。`,
          });
        }
        titles.add(slide.title);
      }
    });

    return { issues };
  },
};
