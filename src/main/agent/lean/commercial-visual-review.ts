import { z } from "zod";

import {
  leanDeckSpecV2Schema,
  type LeanDeckSpecV2,
} from "@shared/lean/deck-spec-v2";
import type { Presentation } from "@shared/presentation";
import type { AgentModelSelection } from "@shared/agent";
import type {
  AgentModelGateway,
  AgentModelMessage,
} from "../gateway/types";
import type { ProviderTokenUsage } from "@shared/token-usage";
import { toolUseBlocksFromContent } from "../gateway/content-blocks";
import {
  slideThumbnailService,
  type SlideThumbnailResult,
} from "../../deck/slide-thumbnail-service";

export const MAX_COMMERCIAL_REVIEW_THUMBNAILS = 6;
export const MAX_COMMERCIAL_VISUAL_REVISIONS = 3;
const REVIEW_TOOL_NAME = "submit_commercial_visual_review";

const visualRevisionSchema = z.object({
  slideIndex: z.number().int().nonnegative(),
  composition: z.enum([
    "full-bleed",
    "split",
    "editorial-grid",
    "image-collage",
    "metric-story",
    "minimal-statement",
  ]),
  imageMode: z.enum(["none", "optional", "required"]),
  assetBrief: z.string().max(180),
  emphasis: z.array(z.string().trim().min(1)).min(1).max(3),
}).strict();

const visualReviewSchema = z.object({
  verdict: z.enum(["approve", "revise"]),
  rationale: z.string().trim().min(1).max(600),
  revisions: z.array(visualRevisionSchema).max(MAX_COMMERCIAL_VISUAL_REVISIONS),
}).strict();

export interface CommercialThumbnailRenderer {
  captureSlide(
    slide: Presentation["slides"][number],
    designSystem: Presentation["designSystem"],
  ): Promise<SlideThumbnailResult | null>;
}

export interface CommercialVisualReviewResult {
  status: "not-available" | "approved" | "revised" | "failed";
  thumbnailCount: number;
  rationale: string;
  revisedSpec?: LeanDeckSpecV2;
  usage?: ProviderTokenUsage;
  modelCallMade: boolean;
  durationMs: number;
}

export function selectCommercialReviewSlideIndices(
  slideCount: number,
  limit = MAX_COMMERCIAL_REVIEW_THUMBNAILS,
): number[] {
  if (slideCount <= 0 || limit <= 0) return [];
  const count = Math.min(slideCount, limit);
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) =>
    Math.round(index * (slideCount - 1) / (count - 1))
  ).filter((value, index, all) => all.indexOf(value) === index);
}

function reviewToolSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(visualReviewSchema, {
    unrepresentable: "throw",
    io: "output",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function applyVisualRevisions(
  spec: LeanDeckSpecV2,
  revisions: z.infer<typeof visualRevisionSchema>[],
): LeanDeckSpecV2 {
  const indices = new Set<number>();
  const revised = structuredClone(spec);
  for (const revision of revisions) {
    if (indices.has(revision.slideIndex) || !revised.slides[revision.slideIndex]) {
      throw new Error(`Invalid or duplicate visual revision index ${revision.slideIndex}.`);
    }
    indices.add(revision.slideIndex);
    revised.slides[revision.slideIndex]!.visual = {
      role: revised.slides[revision.slideIndex]!.visual.role,
      composition: revision.composition,
      imageMode: revision.imageMode,
      assetBrief: revision.imageMode === "none" ? "" : revision.assetBrief,
      emphasis: revision.emphasis,
    };
  }
  return leanDeckSpecV2Schema.parse(revised);
}

export class LeanCommercialVisualReviewer {
  constructor(
    private readonly gateway: AgentModelGateway,
    private readonly thumbnails: CommercialThumbnailRenderer = slideThumbnailService,
  ) {}

  async review(input: {
    spec: LeanDeckSpecV2;
    presentation: Presentation;
    model?: AgentModelSelection;
    signal?: AbortSignal;
  }): Promise<CommercialVisualReviewResult> {
    const startedAt = Date.now();
    const captures: Array<{ index: number; thumbnail: SlideThumbnailResult }> = [];
    let modelCallMade = false;
    try {
      for (const index of selectCommercialReviewSlideIndices(input.presentation.slides.length)) {
        if (input.signal?.aborted) throw new Error("Lean visual review was cancelled.");
        const thumbnail = await this.thumbnails.captureSlide(
          input.presentation.slides[index]!,
          input.presentation.designSystem,
        );
        if (thumbnail) captures.push({ index, thumbnail });
      }
      if (captures.length === 0) {
        return {
          status: "not-available",
          thumbnailCount: 0,
          rationale: "PNG thumbnail rendering is unavailable in this runtime.",
          modelCallMade: false,
          durationMs: Date.now() - startedAt,
        };
      }

      const content: AgentModelMessage["content"] = [{
        type: "text",
        text:
          "Review these slide thumbnails as one commercial deck. Approve if hierarchy, rhythm, composition and visual focus are delivery-ready. "
          + `If revision is necessary, revise at most ${MAX_COMMERCIAL_VISUAL_REVISIONS} slides and only choose replacement visual fields. `
          + "Do not change facts, titles, body copy, numbers, sources, narrative goals, or slide order. Emphasis phrases must be exact visible substrings from the slide.",
      }];
      for (const capture of captures) {
        content.push({
          type: "text",
          text: `Slide ${capture.index + 1}: ${input.presentation.slides[capture.index]!.title}`,
        });
        content.push({
          type: "image",
          mediaType: "image/png",
          data: capture.thumbnail.pngBase64,
        });
      }

      modelCallMade = true;
      const response = await this.gateway.generateText({
        prompt: "Perform one bounded commercial visual review.",
        systemPrompt:
          "You are a commercial presentation art director. Return exactly one visual review tool call. Prefer approval over cosmetic churn. Revisions may only change the declared visual fields.",
        messages: [{ role: "user", content }],
        tools: [{
          name: REVIEW_TOOL_NAME,
          description: "Submit the single bounded visual review result.",
          inputSchema: reviewToolSchema(),
        }],
        requiredToolName: REVIEW_TOOL_NAME,
        maxOutputTokens: 2_000,
        signal: input.signal,
      }, input.model);
      const calls = toolUseBlocksFromContent(response.content).filter(
        (call) => call.name === REVIEW_TOOL_NAME && !call.parseError,
      );
      if (calls.length !== 1) throw new Error("Visual review did not return exactly one valid tool call.");
      const review = visualReviewSchema.parse(calls[0]!.input);
      const reviewedIndices = new Set(captures.map((capture) => capture.index));
      if (review.revisions.some((revision) => !reviewedIndices.has(revision.slideIndex))) {
        throw new Error("Visual review attempted to revise a slide that was not rendered.");
      }
      if (review.verdict === "approve") {
        if (review.revisions.length !== 0) throw new Error("Approved review must not contain revisions.");
        return {
          status: "approved",
          thumbnailCount: captures.length,
          rationale: review.rationale,
          usage: response.usage,
          modelCallMade,
          durationMs: Date.now() - startedAt,
        };
      }
      if (review.revisions.length === 0) throw new Error("Revision verdict requires at least one revision.");
      return {
        status: "revised",
        thumbnailCount: captures.length,
        rationale: review.rationale,
        revisedSpec: applyVisualRevisions(input.spec, review.revisions),
        usage: response.usage,
        modelCallMade,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      return {
        status: "failed",
        thumbnailCount: captures.length,
        rationale: error instanceof Error ? error.message : String(error),
        modelCallMade,
        durationMs: Date.now() - startedAt,
      };
    }
  }
}
