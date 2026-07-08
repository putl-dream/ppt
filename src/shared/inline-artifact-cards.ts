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

const ARTIFACT_REF_PATTERNS: Record<InlineCardType, RegExp[]> = {
  brief: [/\bbrief\.md\b/i, /\bbrief\b/i, /需求简报/, /目的.*受众/],
  outline: [/\boutline\.md\b/i, /\boutline\b/i, /内容大纲/, /章节结构/, /大纲/],
  layout: [/排版方式/, /视觉呈现/, /内容草稿已就绪/, /请选择.*排版/, /layout-choice/i],
  deck: [/\bdeck\//i, /演示文稿/, /\bppt\b/i, /幻灯片/],
};

const EXPORT_PROMPT_PATTERN = /(?:导出|下载|export).*(?:ppt|幻灯片|演示文稿)?|(?:ppt|幻灯片|演示文稿).*(?:导出|下载)/i;
const PREVIEW_PROMPT_PATTERN = /预览.*(?:ppt|幻灯片|演示文稿)|(?:ppt|幻灯片|演示文稿).*预览|打开.*预览/i;
const EXPORT_RESULT_PATTERN = /导出成功|已(?:成功)?导出(?:至|到|为|：|:)|已保存(?:至|到|为|：|:)|已取消导出|导出失败/;

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
  const isExportResult = EXPORT_RESULT_PATTERN.test(content);

  for (const type of inlineCardTypeSchema.options) {
    if (type === "deck" && isExportResult) {
      continue;
    }

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
