import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const selectStyleStrategySchema = z.object({
  targetAudience: z.string().describe("该幻灯片演示的目标受众，如 '高管', '技术研发', '外部客户'"),
  coreMessage: z.string().describe("演示文稿要传达的核心主旨"),
});

/**
 * Deferred Tool: 风格选择策略。
 * 根据用户受众和主旨，返回最适宜的视觉风格方案。
 */
export const selectStyleStrategyTool: ToolDefinition<
  typeof selectStyleStrategySchema,
  { recommendedTheme: string; recommendedPalette: string; fontStack: string }
> = {
  name: "SelectStyleStrategy",
  description: "根据演示目标和受众，推荐契合的视觉风格、色彩调色板及字体组合策略。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: selectStyleStrategySchema,
  risk: "low",
  execute: async (args) => {
    let recommendedTheme = "nordic";
    let recommendedPalette = "cyan";
    let fontStack = "Outfit, Inter, sans-serif";

    if (args.targetAudience.includes("高管") || args.targetAudience.includes("商务")) {
      recommendedTheme = "business-clean";
      recommendedPalette = "warm-gray";
      fontStack = "Georgia, serif";
    } else if (args.targetAudience.includes("技术") || args.targetAudience.includes("研发")) {
      recommendedTheme = "tech-blue";
      recommendedPalette = "electric-blue";
      fontStack = "JetBrains Mono, Outfit, sans-serif";
    }

    return {
      recommendedTheme,
      recommendedPalette,
      fontStack,
    };
  },
};
