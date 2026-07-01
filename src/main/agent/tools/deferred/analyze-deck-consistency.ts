import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { deckValidationService } from "../../../deck/deck-validation-service";

export const analyzeDeckConsistencySchema = z.object({});

/**
 * Deferred Tool: 分析整套 PPT 的字体、间距、颜色、标题层级和布局一致性。
 * 基于规则引擎（LayoutValidator + StyleValidator），不直接生成全局覆盖式修改。
 */
export const analyzeDeckConsistencyTool: ToolDefinition<
  typeof analyzeDeckConsistencySchema,
  {
    issues: Array<{
      slideId?: string;
      category: string;
      severity: "info" | "warning" | "error";
      message: string;
      fixHint?: string;
    }>;
    summary: {
      errorCount: number;
      warningCount: number;
      valid: boolean;
    };
  }
> = {
  name: "AnalyzeDeckConsistency",
  description: "检查整套 PPT 的字体、颜色、间距及排版风格的一致性，输出发现的问题列表。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: analyzeDeckConsistencySchema,
  risk: "low",
  execute: async (_, context) => {
    const result = deckValidationService.validate(context.presentation);

    return {
      issues: result.issues.map((issue) => ({
        slideId: issue.slideId,
        category: issue.category,
        severity: issue.severity,
        message: issue.message,
        fixHint: issue.fixHint,
      })),
      summary: {
        errorCount: result.errorCount,
        warningCount: result.warningCount,
        valid: result.valid,
      },
    };
  },
};
