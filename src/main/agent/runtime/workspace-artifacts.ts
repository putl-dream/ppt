import { access, constants, readFile } from "node:fs/promises";
import { join } from "node:path";

import { LAYOUT_PLAN_PATH } from "@shared/layout-plan";
import {
  isDefaultBriefMarkdown,
  isDefaultOutlineMarkdown,
  parseOutlineItems,
} from "@shared/project-artifacts";
import { isDefaultStoryboardContent, parseStoryboard } from "@shared/storyboard";

export interface WorkspaceArtifacts {
  brief: boolean;
  outline: boolean;
  storyboard: boolean;
  layoutPlan: boolean;
}

export type WorkspaceArtifactStatus = "missing" | "empty" | "default" | "invalid" | "verified";

export interface WorkspaceArtifactProbe {
  path: string;
  status: WorkspaceArtifactStatus;
  verified: boolean;
  reason?: string;
}

export interface WorkspaceArtifactProbeDetails {
  brief: WorkspaceArtifactProbe;
  outline: WorkspaceArtifactProbe;
  storyboard: WorkspaceArtifactProbe;
  layoutPlan: WorkspaceArtifactProbe;
}

const EMPTY_ARTIFACTS: WorkspaceArtifacts = {
  brief: false,
  outline: false,
  storyboard: false,
  layoutPlan: false,
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function missingProbe(path: string): WorkspaceArtifactProbe {
  return { path, status: "missing", verified: false, reason: "File does not exist." };
}

function validateBriefContent(path: string, content: string | undefined): WorkspaceArtifactProbe {
  if (content === undefined) return missingProbe(path);
  const trimmed = content.trim();
  if (!trimmed) return { path, status: "empty", verified: false, reason: "Brief is empty." };
  if (isDefaultBriefMarkdown(trimmed)) {
    return { path, status: "default", verified: false, reason: "Brief still matches the default scaffold." };
  }

  const hasHeading = /^#\s+/m.test(trimmed);
  const hasBriefSignal = /目的|受众|听众|页|页面|幻灯片|规划|大纲|要点|背景|痛点|风格/.test(trimmed);
  if (!hasHeading || !hasBriefSignal) {
    return { path, status: "invalid", verified: false, reason: "Brief lacks recognizable planning signals." };
  }

  return { path, status: "verified", verified: true };
}

function validateOutlineContent(path: string, content: string | undefined): WorkspaceArtifactProbe {
  if (content === undefined) return missingProbe(path);
  const trimmed = content.trim();
  if (!trimmed) return { path, status: "empty", verified: false, reason: "Outline is empty." };
  if (isDefaultOutlineMarkdown(trimmed)) {
    return { path, status: "default", verified: false, reason: "Outline still matches the default scaffold." };
  }

  const hasOutlineShape = /^##\s+\d+[.、]/m.test(trimmed) || /^\d+[.、]\s+/m.test(trimmed);
  const hasSectionGuidance = /section|分隔页|章节|预计\s*\d+\s*页|Hook|Context|Core|Shift|Takeaway/i.test(trimmed);
  const items = parseOutlineItems(trimmed);
  if (items.length < 1 || !hasOutlineShape || !hasSectionGuidance) {
    return {
      path,
      status: "invalid",
      verified: false,
      reason: "Outline lacks slide structure or section guidance.",
    };
  }

  return { path, status: "verified", verified: true };
}

function validateStoryboardContent(path: string, content: string | undefined): WorkspaceArtifactProbe {
  if (content === undefined) return missingProbe(path);
  const trimmed = content.trim();
  if (!trimmed) return { path, status: "empty", verified: false, reason: "Storyboard is empty." };

  let slides;
  try {
    slides = parseStoryboard(trimmed);
  } catch (error) {
    return {
      path,
      status: "invalid",
      verified: false,
      reason: error instanceof Error ? error.message : "Storyboard JSON is invalid.",
    };
  }

  if (isDefaultStoryboardContent(trimmed)) {
    return { path, status: "default", verified: false, reason: "Storyboard still matches the default scaffold." };
  }

  const invalidSlide = slides.find((slide) =>
    !slide.title.trim()
      || !slide.narrativeRole
      || !(slide.layout ?? slide.suggestedLayout)
      || slide.keyPoints.length === 0
      || slide.keyPoints.some((point) => !point.trim())
  );
  if (invalidSlide) {
    return {
      path,
      status: "invalid",
      verified: false,
      reason: `Storyboard slide ${invalidSlide.id} lacks title, role, layout, or key points.`,
    };
  }

  return { path, status: "verified", verified: true };
}

function invalidateProbe(
  probe: WorkspaceArtifactProbe,
  reason: string,
): WorkspaceArtifactProbe {
  return {
    ...probe,
    status: "invalid",
    verified: false,
    reason,
  };
}

function countOutlinePages(content: string): number {
  return parseOutlineItems(content)
    .reduce((total, item) => total + Math.max(1, item.pages || 1), 0);
}

async function probeLayoutPlan(path: string): Promise<WorkspaceArtifactProbe> {
  if (await fileExists(path)) {
    return { path, status: "verified", verified: true };
  }
  return missingProbe(path);
}

export async function probeWorkspaceArtifactDetails(
  workspaceRoot?: string,
): Promise<WorkspaceArtifactProbeDetails> {
  const root = workspaceRoot ?? "";
  const briefPath = join(root, "brief.md");
  const outlinePath = join(root, "outline.md");
  const storyboardPath = join(root, "slides/storyboard.json");
  const layoutPlanPath = join(root, LAYOUT_PLAN_PATH);

  if (!workspaceRoot) {
    return {
      brief: missingProbe(briefPath),
      outline: missingProbe(outlinePath),
      storyboard: missingProbe(storyboardPath),
      layoutPlan: missingProbe(layoutPlanPath),
    };
  }

  const [briefContent, outlineContent, storyboardContent, layoutPlan] = await Promise.all([
    readOptionalText(briefPath),
    readOptionalText(outlinePath),
    readOptionalText(storyboardPath),
    probeLayoutPlan(layoutPlanPath),
  ]);

  const brief = validateBriefContent(briefPath, briefContent);
  const outline = validateOutlineContent(outlinePath, outlineContent);
  let storyboard = validateStoryboardContent(storyboardPath, storyboardContent);

  if (outline.verified && storyboard.verified && outlineContent && storyboardContent) {
    const outlinePages = countOutlinePages(outlineContent);
    const storyboardSlides = parseStoryboard(storyboardContent).length;
    if (outlinePages > 0 && storyboardSlides !== outlinePages) {
      storyboard = invalidateProbe(
        storyboard,
        `Storyboard has ${storyboardSlides} slides but outline expects ${outlinePages} pages.`,
      );
    }
  }

  return { brief, outline, storyboard, layoutPlan };
}

/** Probe workspace files — drives stage resolution, not message keywords. */
export async function probeWorkspaceArtifacts(workspaceRoot?: string): Promise<WorkspaceArtifacts> {
  if (!workspaceRoot) return { ...EMPTY_ARTIFACTS };

  const details = await probeWorkspaceArtifactDetails(workspaceRoot);
  return {
    brief: details.brief.verified,
    outline: details.outline.verified,
    storyboard: details.storyboard.verified,
    layoutPlan: details.layoutPlan.verified,
  };
}
