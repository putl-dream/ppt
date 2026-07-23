import type { PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import {
  auditPresentationVisualAssets,
  type PresentationVisualAssetAudit,
  type SlideVisualAssetAudit,
} from "@shared/visual-asset-audit";
import {
  evaluateDeckVisualQuality,
  type DeckVisualScores,
  type SlideVisualScores,
  type VisualIssue,
} from "@design-system";

import { previewSlideTool } from "../../tools/deferred/preview-slide";
import type { ToolContext } from "../../tools/tool-definition";
import type { PromptStage } from "../prompts/prompt-stage";
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

/** Cap PNG thumbnails per feedback round; structured feedback still covers every affected slide. */
export const MAX_RENDER_FEEDBACK_THUMBNAILS = 6;

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
  visualAsset: SlideVisualAssetAudit;
  thumbnail: RenderFeedbackImage | null;
  thumbnailError?: string;
}

export interface RenderFeedbackPayload {
  proposalSummary: string;
  slides: SlideRenderFeedback[];
  deckScores: DeckVisualScores;
  deckIssues: VisualIssue[];
  visualAssetAudit: PresentationVisualAssetAudit;
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
    `- 图片审计：必补 ${payload.visualAssetAudit.missingRequiredCount} 页，建议补 ${payload.visualAssetAudit.missingRecommendedCount} 页，重复图片 ${payload.visualAssetAudit.duplicateImageUrls.length} 个`,
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
    if (slide.visualAsset.status === "missing-required" || slide.visualAsset.status === "missing-recommended") {
      lines.push(
        `  - 图片动作：调用 SearchSlideImages({"slideId":"${slide.slideId}","query":"${slide.visualAsset.suggestedQuery ?? slide.title}"})，选择候选后调用 InsertSlideImage 放入 ${slide.visualAsset.suggestedSlot ?? "有效图片槽"}。`,
      );
    }
    if (!slide.thumbnail) {
      lines.push(
        slide.thumbnailError
          ? `  （PNG 缩略图生成失败：${slide.thumbnailError}；请依据结构化摘要判断）`
          : "  （本环境无 PNG 缩略图，请依据结构化摘要判断）",
      );
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
  const visualAssetAudit = auditPresentationVisualAssets(draft);
  const evaluationBySlide = new Map(evaluation.slides.map((item) => [item.slideId, item]));
  const visualAssetBySlide = new Map(visualAssetAudit.slides.map((item) => [item.slideId, item]));
  const slideIds = collectAffectedSlideIds(input.commands, draft);

  const previewContext: ToolContext = {
    ...input.context,
    presentation: draft,
  };

  const slides: SlideRenderFeedback[] = [];
  const images: RenderFeedbackImage[] = [];

  for (const [index, slideId] of slideIds.entries()) {
    const result = await previewSlideTool.execute({
      slideId,
      includeThumbnail: index < MAX_RENDER_FEEDBACK_THUMBNAILS,
    }, previewContext);

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
      visualAsset: visualAssetBySlide.get(result.preview.slideId) ?? {
        slideId: result.preview.slideId,
        title: result.preview.title,
        status: "not-needed",
        existingImageCount: result.preview.images.length,
        availableSlots: result.preview.imageSlots,
        reason: "No image requirement was inferred.",
      },
      thumbnail,
      ...(result.thumbnailError ? { thumbnailError: result.thumbnailError } : {}),
    });
  }

  return {
    proposalSummary: input.proposalSummary,
    slides,
    deckScores: evaluation.scores,
    deckIssues: evaluation.issues,
    visualAssetAudit,
    hasThumbnails: images.length > 0,
  };
}

/** Flatten slide thumbnails for gateway image blocks. */
export function extractFeedbackImages(payload: RenderFeedbackPayload): RenderFeedbackImage[] {
  return payload.slides
    .map((slide) => slide.thumbnail)
    .filter((image): image is RenderFeedbackImage => image !== null);
}
