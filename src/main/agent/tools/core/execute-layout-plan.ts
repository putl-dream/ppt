import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  buildLayoutPlanCommands,
  getSelectedDesignDirection,
  LAYOUT_PLAN_PATH,
  parseLayoutPlan,
  validateLayoutPlan,
  validateLayoutPlanAgainstPresentation,
  validateLayoutPlanRhythm,
  type LayoutPlan,
  type LayoutPlanValidationIssue,
} from "@shared/layout-plan";
import type { AgentCommandProposalResult } from "../../runtime/runtime-types";
import { applyCommandsToDraft } from "../../runtime/presentation/layout-command-utils";
import { resolveWorkspacePath } from "../../subagent/workspace-path";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import { insertSlideImageTool } from "./insert-slide-image";

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

async function compileImageEnhancements(
  plan: LayoutPlan,
  laidOutDraft: Presentation,
  context: Parameters<typeof insertSlideImageTool.execute>[1],
): Promise<{ commands: PresentationCommand[]; issues: LayoutPlanValidationIssue[]; count: number }> {
  let draft = laidOutDraft;
  const commands: PresentationCommand[] = [];
  const issues: LayoutPlanValidationIssue[] = [];
  let count = 0;

  for (const slide of plan.slides) {
    for (const enhancement of slide.enhancements) {
      count += 1;
      let result: Awaited<ReturnType<typeof insertSlideImageTool.execute>>;
      try {
        result = await insertSlideImageTool.execute({
          slideId: slide.slideId,
          url: enhancement.url,
          slot: enhancement.slot,
          aspectRatio: enhancement.aspectRatio ?? "auto",
          provider: enhancement.provider,
          sourcePageUrl: enhancement.sourcePageUrl,
          description: enhancement.description,
          attribution: enhancement.attribution,
          license: enhancement.license,
        }, { ...context, presentation: draft });
      } catch (error) {
        issues.push({
          slideId: slide.slideId,
          severity: "error",
          message: `Unable to compile insert-image enhancement for slot '${enhancement.slot}'.`,
          fixHint: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (result.commands.length === 0) {
        issues.push({
          slideId: slide.slideId,
          severity: "error",
          message: `Unable to compile insert-image enhancement for slot '${enhancement.slot}'.`,
          fixHint: result.warnings.join(" ") || "Choose another image candidate or image-capable layout.",
        });
        continue;
      }
      for (const warning of result.warnings) {
        issues.push({
          slideId: slide.slideId,
          severity: "warning",
          message: `Image enhancement warning: ${warning}`,
          fixHint: "Keep source metadata and verify licensing before external distribution.",
        });
      }
      commands.push(...result.commands);
      draft = applyCommandsToDraft(draft, result.commands);
    }
  }

  return { commands, issues, count };
}

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
  behavior: {
    presentation: {
      allowedCapabilities: ["create", "edit", "restyle"],
    },
    capabilities: ["command_proposal"],
    completion: {
      terminalResult: "command_proposal",
      expectation: "when_matching",
      exclusiveBatch: true,
    },
  },
  risk: "low",
  execute: async (args, context) => {
    context.presentationLifecycle?.requireActiveCapability([
      "create",
      "edit",
      "restyle",
    ]);
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

    const validationIssues = [
      ...validateLayoutPlanAgainstPresentation(plan, context.presentation),
      ...validateLayoutPlan(plan),
      ...validateLayoutPlanRhythm(plan),
    ];
    const errors = validationIssues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      return failure(planPath, validationIssues);
    }

    const selectedDirection = getSelectedDesignDirection(plan);
    const layoutCommands = buildLayoutPlanCommands(plan);
    const laidOutDraft = applyCommandsToDraft(context.presentation, layoutCommands);
    const imageCompilation = await compileImageEnhancements(plan, laidOutDraft, context);
    const issues = [...validationIssues, ...imageCompilation.issues];
    if (imageCompilation.issues.some((issue) => issue.severity === "error")) {
      return failure(planPath, issues);
    }
    const commands = [...layoutCommands, ...imageCompilation.commands];
    const layoutTypes = [...new Set(plan.slides.map((slide) => slide.layout))];
    const warningCount = issues.length;
    const summary =
      `Executed layout-plan from ${planPath}: ${plan.slides.length} slides, `
      + `${layoutTypes.length} layout types, visual style ${selectedDirection.designSystem.visualStyle}, `
      + `argument mode ${selectedDirection.designSystem.argumentMode}, `
      + `reading mode ${selectedDirection.designSystem.readingMode}; `
      + `validation passed with ${warningCount} warning/info issue(s).`;

    return {
      type: "command_proposal",
      summary,
      commands,
      risk: "low",
      assumptions: [
        "slides/layout-plan.json is the single source of truth for layout decisions.",
        imageCompilation.count > 0
          ? `${imageCompilation.count} insert-image enhancement(s) were localized and each target slide was reflowed with its selected grammarVariant.`
          : "No insert-image enhancements were requested.",
        "Layout-plan enhancements are limited to executable insert-image operations; chart, table, icon, and decoration changes must use explicit element-targeted commands.",
      ],
    };
  },
};
