import type { PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import {
  evaluateDeckVisualQuality,
  type DeckVisualScores,
  type SlideVisualScores,
  type VisualIssue,
} from "@design-system";

import { previewSlideTool } from "../tools/deferred/preview-slide";
import type { ToolContext } from "../tools/tool-definition";
import type { PromptStage } from "./prompt-stage";
import {
  applyCommandsToDraft,
  collectAffectedSlideIds,
  hasLayoutVisualCommands,
} from "./layout-command-utils";

/** Stages where a single automatic visual review round is offered. */
const RENDER_FEEDBACK_STAGES = new Set<PromptStage>([
  "style",
  "edit",
]);

/** Cap thumbnails per feedback round to control token cost. */
export const MAX_RENDER_FEEDBACK_SLIDES = 6;

export interface RenderFeedbackImage {
  mediaType: "image/png";
  data: string;
  slideId: string;
  title: string;
}

export interface SlideRenderFeedback {
  slideId: string;
  title: string;
  layout?: string;
  grammarVariant?: string;
  description: string;
  scores: SlideVisualScores;
  issues: VisualIssue[];
  thumbnail: RenderFeedbackImage | null;
}

export interface RenderFeedbackPayload {
  proposalSummary: string;
  slides: SlideRenderFeedback[];
  deckScores: DeckVisualScores;
  deckIssues: VisualIssue[];
  hasThumbnails: boolean;
}

export function shouldOfferRenderFeedback(
  stage: PromptStage | undefined,
  commands: PresentationCommand[],
  alreadyUsed: boolean,
): boolean {
  if (alreadyUsed || !stage || !RENDER_FEEDBACK_STAGES.has(stage)) return false;
  return hasLayoutVisualCommands(commands);
}

export function formatRenderFeedbackMessage(payload: RenderFeedbackPayload): string {
  const lines = [
    "## 排版视觉反馈（系统自动生成）",
    "",
    "你刚提交的排版方案已在沙箱中渲染，并由设计引擎完成结构化视觉评分：",
    `- Deck 总分 ${payload.deckScores.overall}/100；一致性 ${payload.deckScores.consistency}；差异度 ${payload.deckScores.differentiation}`,
    "- 若需修正：再次调用 SubmitCommands 提交修复命令",
    "- 若满意：再次调用 SubmitCommands，summary 注明「视觉确认通过」并复提交或微调后的命令",
    "",
    `方案摘要：${payload.proposalSummary}`,
    "",
    "### 各页预览",
  ];

  for (const slide of payload.slides) {
    lines.push(
      `- **${slide.title}** (\`${slide.slideId}\`) · ${slide.scores.overall}/100 · layout=${slide.layout ?? "unset"}${slide.grammarVariant ? `/${slide.grammarVariant}` : ""} · ${slide.description}`,
    );
    for (const issue of slide.issues) lines.push(`  - ${issue.message} 建议：${issue.suggestion}`);
    if (!slide.thumbnail) {
      lines.push("  （本环境无 PNG 缩略图，请依据结构化摘要判断）");
    }
  }

  if (payload.hasThumbnails) {
    lines.push("", "缩略图附在本消息中，请逐页查看。");
  }

  return lines.join("\n");
}

export async function buildRenderFeedback(
  input: {
    presentation: Presentation;
    commands: PresentationCommand[];
    proposalSummary: string;
    context: ToolContext;
  },
): Promise<RenderFeedbackPayload> {
  const draft = applyCommandsToDraft(input.presentation, input.commands);
  const evaluation = evaluateDeckVisualQuality(draft.designSystem, draft.slides);
  const evaluationBySlide = new Map(evaluation.slides.map((item) => [item.slideId, item]));
  const slideIds = collectAffectedSlideIds(input.commands, draft).slice(0, MAX_RENDER_FEEDBACK_SLIDES);

  const previewContext: ToolContext = {
    ...input.context,
    presentation: draft,
  };

  const slides: SlideRenderFeedback[] = [];
  const images: RenderFeedbackImage[] = [];

  for (const slideId of slideIds) {
    const result = await previewSlideTool.execute({ slideId, includeThumbnail: true }, previewContext);
    if (!result.preview) continue;

    let thumbnail: RenderFeedbackImage | null = null;
    if (result.thumbnail?.pngBase64) {
      thumbnail = {
        mediaType: "image/png",
        data: result.thumbnail.pngBase64,
        slideId: result.preview.slideId,
        title: result.preview.title,
      };
      images.push(thumbnail);
    }

    slides.push({
      slideId: result.preview.slideId,
      title: result.preview.title,
      layout: result.preview.layout,
      grammarVariant: result.preview.grammarVariant,
      description: result.preview.description,
      scores: evaluationBySlide.get(result.preview.slideId)?.scores ?? {
        hierarchy: 0,
        readability: 0,
        density: 0,
        visualAnchor: 0,
        composition: 0,
        overall: 0,
      },
      issues: evaluationBySlide.get(result.preview.slideId)?.issues ?? [],
      thumbnail,
    });
  }

  return {
    proposalSummary: input.proposalSummary,
    slides,
    deckScores: evaluation.scores,
    deckIssues: evaluation.issues,
    hasThumbnails: images.length > 0,
  };
}

/** Flatten slide thumbnails for gateway image blocks. */
export function extractFeedbackImages(payload: RenderFeedbackPayload): RenderFeedbackImage[] {
  return payload.slides
    .map((slide) => slide.thumbnail)
    .filter((image): image is RenderFeedbackImage => image !== null);
}
