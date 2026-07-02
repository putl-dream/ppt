import { z } from "zod";
import type { Presentation } from "./presentation";
import type { ProjectStageId } from "./project";
import {
  hasMeaningfulArtifactContent,
  isDefaultArtifactContent,
} from "./agent-run-plan";
import type { BriefFields, OutlineItem } from "./project-artifacts";
import { parseBriefFields, parseOutlineItems } from "./project-artifacts";

export const inlineCardTypeSchema = z.enum(["brief", "outline", "deck"]);
export type InlineCardType = z.infer<typeof inlineCardTypeSchema>;

export const inlineCardRefSchema = z.object({
  type: inlineCardTypeSchema,
  resolved: z.enum(["confirmed", "dismissed"]).optional(),
});
export type InlineCardRef = z.infer<typeof inlineCardRefSchema>;

const ARTIFACT_REF_PATTERNS: Record<InlineCardType, RegExp[]> = {
  brief: [/\bbrief\.md\b/i, /\bbrief\b/i, /需求简报/, /目的.*受众/],
  outline: [/\boutline\.md\b/i, /\boutline\b/i, /内容大纲/, /章节结构/, /大纲/],
  deck: [/\bdeck\//i, /演示文稿/, /\bppt\b/i, /幻灯片/, /导出/],
};

const EXPORT_PROMPT_PATTERN = /(?:导出|下载|export).*(?:ppt|幻灯片|演示文稿)?|(?:ppt|幻灯片|演示文稿).*(?:导出|下载)/i;
const PREVIEW_PROMPT_PATTERN = /预览.*(?:ppt|幻灯片|演示文稿)|(?:ppt|幻灯片|演示文稿).*预览|打开.*预览/i;

export function isExportPrompt(prompt: string): boolean {
  return EXPORT_PROMPT_PATTERN.test(prompt.trim());
}

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

export function parseInlineCardsFromContent(content: string): InlineCardType[] {
  const found: InlineCardType[] = [];
  for (const type of inlineCardTypeSchema.options) {
    if (ARTIFACT_REF_PATTERNS[type].some((pattern) => pattern.test(content))) {
      found.push(type);
    }
  }
  return found;
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
    case "deck":
      return Boolean(
        context.presentation
        && (context.presentation.revision > 0 || context.presentation.slides.length > 1
          || (context.presentation.slides.length === 1
            && context.presentation.slides[0]?.title !== "项目起点")),
      );
    default:
      return false;
  }
}

export function resolveMessageInlineCards(
  content: string,
  persisted: InlineCardRef[] | undefined,
  context: InlineCardContext,
): InlineCardRef[] {
  const merged = mergeInlineCardRefs(persisted, parseInlineCardsFromContent(content));
  return merged.filter((card) => shouldShowInlineCard(card.type, context));
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
