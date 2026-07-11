import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { DESIGN_PRESETS, type DesignSystemV1 } from "@design-system";

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
  { presetId: string; label: string; designSystem: DesignSystemV1 }
> = {
  name: "SelectStyleStrategy",
  description: "根据演示目标和受众，推荐契合的视觉风格、色彩调色板及字体组合策略。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: selectStyleStrategySchema,
  risk: "low",
  execute: async (args) => {
    let presetId = "business";

    if (
      args.targetAudience.includes("竞聘")
      || args.coreMessage.includes("竞聘")
      || args.coreMessage.includes("工作汇报")
    ) {
      presetId = "report";
    } else if (
      args.targetAudience.includes("人文")
      || args.targetAudience.includes("杂志")
      || args.coreMessage.includes("故事")
    ) {
      presetId = "editorial";
    } else if (args.targetAudience.includes("高管") || args.targetAudience.includes("商务")) {
      presetId = "business";
    } else if (args.targetAudience.includes("技术") || args.targetAudience.includes("研发")) {
      presetId = "technical";
    }
    const preset = DESIGN_PRESETS.find((item) => item.id === presetId) ?? DESIGN_PRESETS[0];
    return { presetId: preset.id, label: preset.label, designSystem: preset.system };
  },
};
