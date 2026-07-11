import type { Presentation } from "@shared/presentation";

import type { WorkspaceArtifacts } from "./workspace-artifacts";
import { isExplicitExportPrompt } from "./export-intent";

/**
 * Merged prompt stages (6). Replaces the former 9-stage machine:
 *
 * | New       | Former |
 * |-----------|--------|
 * | discover  | routing + planning |
 * | author    | content + layout-choice |
 * | design    | layout-design |
 * | style     | layout-exec + review |
 * | edit      | light-edit |
 * | export    | export |
 */
export const PROMPT_STAGES = [
  "discover",
  "author",
  "design",
  "style",
  "edit",
  "export",
] as const;

export type PromptStage = (typeof PROMPT_STAGES)[number];

/** Former 9-stage identifiers → merged stage (for tests, stageHint, old SKILL frontmatter). */
export const LEGACY_PROMPT_STAGE_MAP: Record<string, PromptStage> = {
  routing: "discover",
  planning: "discover",
  content: "author",
  "layout-choice": "author",
  "layout-design": "design",
  "layout-exec": "style",
  review: "style",
  "light-edit": "edit",
};

export function normalizePromptStage(stage: string): PromptStage {
  if ((PROMPT_STAGES as readonly string[]).includes(stage)) {
    return stage as PromptStage;
  }
  const legacy = LEGACY_PROMPT_STAGE_MAP[stage];
  if (legacy) return legacy;
  throw new Error(`Unknown prompt stage: ${stage}`);
}

export interface PromptStageResolveInput {
  request: string;
  presentation: Presentation;
  artifacts: WorkspaceArtifacts;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Explicit override from harness (e.g. tests). Accepts legacy stage names. */
  stageHint?: string;
}

const LAYOUT_PHASE_PATTERNS = [
  /执行(?:标准|创意装饰)?排版/,
  /第二阶段/,
  /layout-plan/i,
  /update-slide-layout/i,
  /set-design-system/i,
];

const LIGHT_EDIT_PATTERNS = [
  /改(?:一|这|某|第\s*\d+)页/,
  /第\s*\d+\s*页.{0,12}(?:换|改|调|删|加|移|替换)/,
  /(?:换|改|调|替换).{0,8}第\s*\d+\s*页/,
  /换(?:标题|文字|图|图片|配色|背景)/,
  /修改.{0,8}页/,
  /调整.{0,8}(?:文字|图|图片|排版)/,
  /(?:某|这|那)一?页/,
];

const NEW_DECK_PATTERNS = [
  /新建|创建/,
  /做(?:一|个).{0,6}(?:ppt|演示|deck|幻灯片)/i,
  /从零|一条龙/,
  /完整.{0,4}(?:ppt|演示|汇报|方案)/i,
  /(?:整理|做|制作|生成|写).{0,4}成.{0,6}(?:ppt|演示|汇报|幻灯片|deck)/i,
  /一[套份].{0,8}(?:ppt|演示|汇报|幻灯片|deck)/i,
];

function isLayoutPhaseRequest(request: string): boolean {
  return LAYOUT_PHASE_PATTERNS.some((pattern) => pattern.test(request));
}

function isExportRequest(request: string): boolean {
  return isExplicitExportPrompt(request);
}

function isLightEditRequest(request: string, slideCount: number): boolean {
  if (slideCount === 0) return false;
  return LIGHT_EDIT_PATTERNS.some((pattern) => pattern.test(request));
}

function isAwaitingLayoutChoice(
  messageHistory: Array<{ role: "user" | "assistant"; content: string }> | undefined,
): boolean {
  if (!messageHistory?.length) return false;
  for (let index = messageHistory.length - 1; index >= 0; index -= 1) {
    const message = messageHistory[index];
    if (message.role === "assistant") {
      return /内容草稿已就绪|待排版|请选择.*排版/.test(message.content);
    }
  }
  return false;
}

function suggestsLargeNewDeck(request: string, artifacts: WorkspaceArtifacts): boolean {
  if (artifacts.outline || artifacts.storyboard) return false;
  return NEW_DECK_PATTERNS.some((pattern) => pattern.test(request));
}

/**
 * Resolve the active prompt stage from runtime facts (artifacts, deck state, request class).
 */
export function resolvePromptStage(input: PromptStageResolveInput): PromptStage {
  if (input.stageHint) return normalizePromptStage(input.stageHint);

  const slideCount = input.presentation.slides?.length ?? 0;
  const hasUnstyledSlides = input.presentation.slides.some((slide) => !slide.layout);

  if (isExportRequest(input.request)) return "export";

  if (isLayoutPhaseRequest(input.request)) {
    return input.artifacts.layoutPlan ? "style" : "design";
  }

  if (input.artifacts.layoutPlan && slideCount > 0 && hasUnstyledSlides) {
    return "style";
  }

  if (isLightEditRequest(input.request, slideCount) && !hasUnstyledSlides) {
    return "edit";
  }

  // layout-choice merged into author — same stage, different sub-mode via message history
  if (slideCount > 0 && hasUnstyledSlides && isAwaitingLayoutChoice(input.messageHistory)) {
    return "author";
  }

  if (suggestsLargeNewDeck(input.request, input.artifacts)) {
    return "discover";
  }

  if (slideCount > 0 && hasUnstyledSlides) {
    return "author";
  }

  if (input.artifacts.storyboard || input.artifacts.outline) {
    return "author";
  }

  if (input.artifacts.brief) {
    return "author";
  }

  if (slideCount > 0) {
    return hasUnstyledSlides ? "author" : "edit";
  }

  return "discover";
}

export function describePromptStage(stage: PromptStage): string {
  const labels: Record<PromptStage, string> = {
    discover: "路径选择与规划（brief / outline / storyboard）",
    author: "内容撰写与草稿落盘（含等待排版选择）",
    design: "排版设计（layout-plan）",
    style: "视觉排版执行与质检",
    edit: "轻量单页修改",
    export: "导出交付",
  };
  return labels[stage];
}

/** Whether author stage is waiting for the user to pick a layout mode (former layout-choice). */
export function isAuthorAwaitingLayoutChoice(
  stage: PromptStage,
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>,
): boolean {
  return stage === "author" && isAwaitingLayoutChoice(messageHistory);
}
