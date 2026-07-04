import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { validateDeckRhythm } from "@shared/deck-rhythm";

export const validateDeckLayoutSchema = z.object({});

/**
 * Core Tool: 程序化校验 deck 版式节奏与多样性（guizang 规则）。
 * P2-2：从 Deferred 提升为 Core，layout/review 阶段可直接调用。
 */
export const validateDeckLayoutTool: ToolDefinition<
  typeof validateDeckLayoutSchema,
  {
    issues: Array<{
      slideId?: string;
      severity: "info" | "warning" | "error";
      message: string;
      fixHint?: string;
    }>;
    summary: {
      slideCount: number;
      layoutTypes: string[];
      errorCount: number;
      warningCount: number;
      valid: boolean;
    };
  }
> = {
  name: "ValidateDeckLayout",
  description: "校验 deck 版式节奏：无连续 3 页同 layout、多样性、cover/section/summary 覆盖。",
  category: "core",
  loadPolicy: "core",
  inputSchema: validateDeckLayoutSchema,
  risk: "low",
  execute: async (_, context) => {
    const issues = validateDeckRhythm(context.presentation);
    const layoutTypes = [
      ...new Set(
        context.presentation.slides
          .map((slide) => slide.layout)
          .filter((layout): layout is string => Boolean(layout)),
      ),
    ];

    const errorCount = issues.filter((issue) => issue.severity === "error").length;
    const warningCount = issues.filter(
      (issue) => issue.severity === "warning" || issue.severity === "info",
    ).length;

    return {
      issues,
      summary: {
        slideCount: context.presentation.slides.length,
        layoutTypes,
        errorCount,
        warningCount,
        valid: errorCount === 0,
      },
    };
  },
};
