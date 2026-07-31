import { z } from "zod";
import {
  ARGUMENT_MODES,
  colorSchemeSchema,
  READING_MODES,
  VISUAL_STYLES,
} from "@design-system";
import {
  communicationContractSchema,
  type DesignPlanCandidate,
} from "@shared/design-plan";
import { resolveDesignPlan } from "@shared/design-recommendation";
import type { ToolDefinition } from "../tool-definition";

export const resolveDesignPlanSchema = z.object({
  communicationContract: communicationContractSchema,
  sourceText: z.string().max(2_000).optional()
    .describe("可选主题、行业、品牌等补充信号；不替代沟通契约"),
  argumentMode: z.enum(ARGUMENT_MODES).optional(),
  readingMode: z.enum(READING_MODES).optional(),
  colorScheme: colorSchemeSchema.optional(),
  visualStyle: z.enum(VISUAL_STYLES).optional()
    .describe("仅当用户明确指定视觉风格时传入；传入后直接生成 locked direction"),
}).strict();

/**
 * Deferred Tool: resolve the deck-wide communication and design decision.
 */
export const resolveDesignPlanTool: ToolDefinition<
  typeof resolveDesignPlanSchema,
  DesignPlanCandidate
> = {
  name: "ResolveDesignPlan",
  description:
    "基于完整沟通契约，独立解析 argument mode、visual style、color scheme 与 reading mode；"
    + "未指定风格时返回 safe/shifted/bold 三档，明确指定时返回 locked 方向。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: resolveDesignPlanSchema,
  behavior: {
    presentation: {
      allowedCapabilities: ["create", "edit", "restyle"],
    },
  },
  risk: "low",
  execute: async (args) => resolveDesignPlan(args),
};
