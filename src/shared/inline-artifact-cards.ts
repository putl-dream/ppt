import { z } from "zod";
import type { Presentation } from "./presentation";
import { presentationNeedsLayoutChoice } from "./presentation-draft";
import type { ProjectStageId } from "./project";
import {
  hasMeaningfulArtifactContent,
  isDefaultArtifactContent,
} from "./project-artifact-state";
import type { BriefFields, OutlineItem } from "./project-artifacts";
import { parseBriefFields, parseOutlineItems } from "./project-artifacts";

export const inlineCardTypeSchema = z.enum(["brief", "outline", "layout", "deck"]);
export type InlineCardType = z.infer<typeof inlineCardTypeSchema>;

export const layoutVisualModeSchema = z.enum(["template", "creative"]);
export type LayoutVisualMode = z.infer<typeof layoutVisualModeSchema>;

export const inlineCardRefSchema = z.object({
  type: inlineCardTypeSchema,
  resolved: z.enum(["confirmed", "dismissed"]).optional(),
  layoutMode: layoutVisualModeSchema.optional(),
});
export type InlineCardRef = z.infer<typeof inlineCardRefSchema>;

const PREVIEW_PROMPT_PATTERN = /预览.*(?:ppt|幻灯片|演示文稿)|(?:ppt|幻灯片|演示文稿).*预览|打开.*预览/i;

export function isPreviewPrompt(prompt: string): boolean {
  return PREVIEW_PROMPT_PATTERN.test(prompt.trim());
}

export function artifactStageToInlineCardType(
  stage: ProjectStageId | undefined,
): InlineCardType | undefined {
  if (stage === "brief") return "brief";
  if (stage === "outline") return "outline";
  if (stage === "deck") return "deck";
  return undefined;
}

export function mergeInlineCardRefs(
  existing: InlineCardRef[] | undefined,
  additions: InlineCardType[],
): InlineCardRef[] {
  const merged = new Map<InlineCardType, InlineCardRef>();
  for (const card of existing ?? []) {
    merged.set(card.type, card);
  }
  for (const type of additions) {
    if (!merged.has(type)) {
      merged.set(type, { type });
    }
  }
  return inlineCardTypeSchema.options
    .filter((type) => merged.has(type))
    .map((type) => merged.get(type)!);
}

export interface InlineCardContext {
  briefContent?: string;
  outlineContent?: string;
  presentation?: Presentation;
  projectTitle?: string;
}

export function shouldShowInlineCard(
  type: InlineCardType,
  context: InlineCardContext,
): boolean {
  switch (type) {
    case "brief":
      return hasMeaningfulArtifactContent("brief", context.briefContent);
    case "outline":
      return hasMeaningfulArtifactContent("outline", context.outlineContent);
    case "layout":
      return presentationNeedsLayoutChoice(context.presentation);
    case "deck":
      // 新项目从空 deck 起步，任何存在的幻灯片都是真实内容
      return Boolean(
        context.presentation
        && !presentationNeedsLayoutChoice(context.presentation)
        && (context.presentation.revision > 0 || context.presentation.slides.length > 0),
      );
    default:
      return false;
  }
}

export function resolveMessageInlineCards(
  persisted: InlineCardRef[] | undefined,
  context: InlineCardContext,
): InlineCardRef[] {
  // UI card rendering is intentionally contract-driven: the renderer only
  // displays cards explicitly attached by the app/main process in `inlineCards`.
  return mergeInlineCardRefs(persisted, [])
    .filter((card) => shouldShowInlineCard(card.type, context));
}

export function parseBriefForCard(
  content: string,
  fallbackTitle?: string,
): BriefFields {
  return parseBriefFields(content, fallbackTitle ?? "新演示文稿");
}

export function parseOutlineForCard(content: string): OutlineItem[] {
  const items = parseOutlineItems(content);
  if (items.length === 1 && isDefaultArtifactContent("outline", content)) {
    return [];
  }
  return items;
}
