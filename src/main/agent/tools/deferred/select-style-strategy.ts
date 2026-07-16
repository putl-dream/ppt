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
  {
    presetId: string;
    label: string;
    designSystem: DesignSystemV1;
    matchedKeywords: string[];
    reason: string;
  }
> = {
  name: "SelectStyleStrategy",
  description: "基于明确的受众与主题关键词，从内置设计预设中选择可解释的视觉策略。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: selectStyleStrategySchema,
  risk: "low",
  execute: async (args) => {
    const source = `${args.targetAudience} ${args.coreMessage}`.toLowerCase();
    const strategies = [
      {
        presetId: "report",
        keywords: ["竞聘", "工作汇报", "经营分析", "财务", "复盘", "周报", "月报", "年度报告", "business review", "financial", "operations report"],
      },
      {
        presetId: "technical",
        keywords: ["技术", "研发", "工程", "架构", "数据", "人工智能", "开发者", "technical", "engineering", "architecture", "developer", "api", "ai"],
      },
      {
        presetId: "academic",
        keywords: ["学术", "研究", "教育", "课程", "教师", "学生", "论文", "academic", "research", "education", "course", "lecture"],
      },
      {
        presetId: "editorial",
        keywords: ["人文", "杂志", "故事", "文化", "艺术", "品牌叙事", "editorial", "magazine", "story", "culture", "art"],
      },
      {
        presetId: "business",
        keywords: ["高管", "商务", "客户", "外部客户", "投资人", "销售", "方案", "executive", "business", "customer", "client", "investor", "sales", "proposal"],
      },
    ] as const;

    let presetId = "business";
    let matchedKeywords: string[] = [];
    for (const strategy of strategies) {
      const matched = strategy.keywords.filter((keyword) => source.includes(keyword));
      if (matched.length === 0) continue;
      presetId = strategy.presetId;
      matchedKeywords = matched;
      break;
    }

    const preset = DESIGN_PRESETS.find((item) => item.id === presetId) ?? DESIGN_PRESETS[0];
    return {
      presetId: preset.id,
      label: preset.label,
      designSystem: preset.system,
      matchedKeywords,
      reason: matchedKeywords.length > 0
        ? `Matched explicit audience/topic keywords: ${matchedKeywords.join(", ")}.`
        : "No specialized keywords matched; using the neutral business preset.",
    };
  },
};
