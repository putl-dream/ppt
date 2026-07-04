import type { Presentation } from "@shared/presentation";

import type { WorkspaceArtifacts } from "./workspace-artifacts";

export const PROMPT_STAGES = [
  "routing",
  "planning",
  "content",
  "layout-choice",
  "layout-design",
  "layout-exec",
  "review",
  "light-edit",
  "export",
] as const;

export type PromptStage = (typeof PROMPT_STAGES)[number];

export interface PromptStageResolveInput {
  request: string;
  presentation: Presentation;
  artifacts: WorkspaceArtifacts;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Explicit override from harness (e.g. tests). */
  stageHint?: PromptStage;
}

const LAYOUT_PHASE_PATTERNS = [
  /执行(?:标准|创意装饰)?排版/,
  /第二阶段/,
  /layout-plan/i,
  /update-slide-layout/i,
  /set-theme/i,
];

const EXPORT_PATTERNS = [/导出|下载|pptx|export/i];

const LIGHT_EDIT_PATTERNS = [
  /改(?:一|这|某)页/,
  /换(?:标题|文字)/,
  /修改.{0,8}页/,
  /调整.{0,8}文字/,
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
  return EXPORT_PATTERNS.some((pattern) => pattern.test(request));
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
  // Only a finished storyboard means we've genuinely entered content authoring;
  // a stray brief/outline should not block re-planning a fresh full deck.
  if (artifacts.storyboard) return false;
  return NEW_DECK_PATTERNS.some((pattern) => pattern.test(request));
}

/**
 * Resolve the active prompt stage from runtime facts (artifacts, deck state, request class).
 */
export function resolvePromptStage(input: PromptStageResolveInput): PromptStage {
  if (input.stageHint) return input.stageHint;

  const slideCount = input.presentation.slides?.length ?? 0;
  const hasTheme = Boolean(input.presentation.theme?.trim());

  if (isExportRequest(input.request)) return "export";

  if (isLayoutPhaseRequest(input.request)) {
    return input.artifacts.layoutPlan ? "layout-exec" : "layout-design";
  }

  if (input.artifacts.layoutPlan && slideCount > 0 && !hasTheme) {
    return "layout-exec";
  }

  if (isLightEditRequest(input.request, slideCount) && hasTheme) {
    return "light-edit";
  }

  if (slideCount > 0 && !hasTheme && isAwaitingLayoutChoice(input.messageHistory)) {
    return "layout-choice";
  }

  // An explicit "build a full deck" request re-enters planning even when stray
  // slides exist — suggestsLargeNewDeck already bails once a storyboard is present,
  // so genuine in-progress content is never bounced back.
  if (suggestsLargeNewDeck(input.request, input.artifacts)) {
    return "planning";
  }

  if (slideCount > 0 && !hasTheme) {
    return "content";
  }

  if (input.artifacts.storyboard || input.artifacts.outline) {
    return "content";
  }

  if (input.artifacts.brief) {
    return "content";
  }

  if (slideCount > 0) {
    return hasTheme ? "light-edit" : "content";
  }

  return "routing";
}

export function describePromptStage(stage: PromptStage): string {
  const labels: Record<PromptStage, string> = {
    routing: "路径选择",
    planning: "规划（brief/outline/storyboard）",
    content: "内容撰写与草稿落盘",
    "layout-choice": "等待用户选择排版方式",
    "layout-design": "排版设计（layout-plan）",
    "layout-exec": "视觉排版执行",
    review: "质检与润色",
    "light-edit": "轻量单页修改",
    export: "导出交付",
  };
  return labels[stage];
}
