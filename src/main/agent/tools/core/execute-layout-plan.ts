import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  buildLayoutPlanCommands,
  LAYOUT_PLAN_PATH,
  parseLayoutPlan,
  validateLayoutPlan,
  validateLayoutPlanAgainstPresentation,
  validateLayoutPlanRhythm,
  type LayoutPlan,
  type LayoutPlanValidationIssue,
} from "@shared/layout-plan";
import type { AgentCommandProposalResult } from "../../runtime/runtime-types";
import { resolveWorkspacePath } from "../../subagent/workspace-path";
import type { ToolDefinition } from "../tool-definition";

export const executeLayoutPlanSchema = z.object({
  path: z.string().optional().describe("Workspace-relative layout plan path; defaults to slides/layout-plan.json"),
});

interface ExecuteLayoutPlanFailure {
  success: false;
  path: string;
  issues: LayoutPlanValidationIssue[];
  summary: {
    valid: false;
    errorCount: number;
    warningCount: number;
  };
  guidance: string;
}

type ExecuteLayoutPlanResult = AgentCommandProposalResult | ExecuteLayoutPlanFailure;

function failure(path: string, issues: LayoutPlanValidationIssue[]): ExecuteLayoutPlanFailure {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return {
    success: false,
    path,
    issues,
    summary: {
      valid: false,
      errorCount,
      warningCount,
    },
    guidance:
      "Do not freestyle layouts from memory. Regenerate or fix slides/layout-plan.json, then call ExecuteLayoutPlan again.",
  };
}

/**
 * Core Tool: load the Design Agent's layout-plan, validate it as the single
 * source of truth, and convert it into the final command proposal.
 */
export const executeLayoutPlanTool: ToolDefinition<
  typeof executeLayoutPlanSchema,
  ExecuteLayoutPlanResult
> = {
  name: "ExecuteLayoutPlan",
  description:
    "受控执行 layout-plan：读取 slides/layout-plan.json，校验与当前快照一致，"
    + "再生成 set-design-system/update-slide-layout/update-slide-variant 命令。不要手工重猜 layout。",
  category: "core",
  loadPolicy: "core",
  inputSchema: executeLayoutPlanSchema,
  risk: "low",
  execute: async (args, context) => {
    const planPath = args.path?.trim() || LAYOUT_PLAN_PATH;
    if (!context.workspaceRoot) {
      return failure(planPath, [{
        severity: "error",
        message: "Workspace root is not configured; cannot read layout-plan.",
        fixHint: "Run this tool only in a workspace-backed PPT session.",
      }]);
    }

    let raw: string;
    try {
      const filePath = resolveWorkspacePath(context.workspaceRoot, planPath);
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      return failure(planPath, [{
        severity: "error",
        message: `Unable to read layout-plan '${planPath}': ${error instanceof Error ? error.message : String(error)}`,
        fixHint: "Ensure the Design Agent wrote slides/layout-plan.json in the current workspace.",
      }]);
    }

    let plan: LayoutPlan;
    try {
      plan = parseLayoutPlan(raw);
    } catch (error) {
      return failure(planPath, [{
        severity: "error",
        message: `Invalid layout-plan JSON/schema: ${error instanceof Error ? error.message : String(error)}`,
        fixHint: "Regenerate the plan using the ppt-design-layout schema.",
      }]);
    }

    const issues = [
      ...validateLayoutPlanAgainstPresentation(plan, context.presentation),
      ...validateLayoutPlan(plan),
      ...validateLayoutPlanRhythm(plan),
    ];
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      return failure(planPath, issues);
    }

    const commands = buildLayoutPlanCommands(plan);
    const layoutTypes = [...new Set(plan.slides.map((slide) => slide.layout))];
    const warningCount = issues.length;
    const enhancementCount = plan.slides.reduce(
      (total, slide) => total + slide.enhancements.length,
      0,
    );

    const summary =
      `Executed layout-plan from ${planPath}: ${plan.slides.length} slides, `
      + `${layoutTypes.length} layout types, design palette ${plan.designSystem.tokens.palette}; `
      + `validation passed with ${warningCount} warning/info issue(s).`;

    return {
      type: "command_proposal",
      summary,
      commands,
      risk: "low",
      assumptions: [
        "slides/layout-plan.json is the single source of truth for layout decisions.",
        "Only designSystem, layout, grammarVariant, designOverride, and slideVariant are executed in this step.",
        enhancementCount > 0
          ? `${enhancementCount} enhancement item(s) remain for ExecuteExtraTool.`
          : "No layout-plan enhancements were requested.",
      ],
    };
  },
};
