import { z } from "zod";
import { getLayoutSlotRect, listLayoutSlots } from "@shared/layout-slots";
import type { Slide } from "@shared/presentation";
import type { WebSearchOutput } from "../../search/web-search";
import { imageSearchService } from "../../search/image-search-service";
import type { ToolDefinition } from "../tool-definition";

export const searchSlideImagesSchema = z.object({
  slideId: z.string().describe("需要配图的幻灯片 ID；工具会读取标题、layout 和空图片槽"),
  query: z.string().trim().min(1).max(300).optional()
    .describe("可选搜索意图；省略时根据 slide.title 自动生成"),
  slot: z.string().optional().describe("目标图片槽；省略时自动选择第一个空槽"),
  visualKind: z.enum(["photo", "illustration", "evidence", "logo"]).optional().default("photo")
    .describe("需要的视觉类型"),
  sourceMode: z.enum(["free", "web"]).optional().default("free")
    .describe("free 优先 Pexels/Pixabay/Unsplash/Wikimedia；web 搜索全网但必须另行核对授权"),
  maxImages: z.number().int().min(1).max(8).optional().default(5),
});

export interface SlideImageCandidate {
  candidateId: string;
  url: string;
  description: string;
  provider?: string;
  sourcePageUrl?: string;
  licenseStatus: "unknown";
  /** Metadata for localizing the asset and embedding it in page SVG. */
  assetArgs: {
    slideId: string;
    url: string;
    slot?: string;
    aspectRatio: "16:9" | "4:3" | "1:1" | "auto";
    objectFit: "cover";
    provider?: string;
    sourcePageUrl?: string;
    description: string;
  };
}

export interface SearchSlideImagesOutput {
  slideId: string;
  query: string;
  slot?: string;
  candidates: SlideImageCandidate[];
  guidance: string;
  rawSearch: WebSearchOutput;
}

function aspectRatioForSlot(
  slide: Slide,
  slot: string | undefined,
): "16:9" | "4:3" | "1:1" | "auto" {
  if (!slot) return "auto";
  const rect = getLayoutSlotRect(slide, slot);
  if (!rect) return "auto";
  const ratio = rect.width / rect.height;
  if (ratio > 1.5) return "16:9";
  if (ratio < 1.15) return "1:1";
  return "4:3";
}

function formatSearchSlideImagesOutput(output: SearchSlideImagesOutput): string {
  if (output.candidates.length === 0) {
    return `No usable image candidates found for slide ${output.slideId}. Try a more concrete query or sourceMode=web.`;
  }
  return [
    `Image candidates for slide ${output.slideId} (target slot: ${output.slot ?? "no valid slot"}):`,
    ...output.candidates.map((candidate, index) => [
      `${index + 1}. ${candidate.description}`,
      `   image: ${candidate.url}`,
      `   provider: ${candidate.provider ?? "unknown"}`,
      `   source page: ${candidate.sourcePageUrl ?? "missing — verify before use"}`,
      `   license status: ${candidate.licenseStatus}`,
      `   asset args: ${JSON.stringify(candidate.assetArgs)}`,
    ].join("\n")),
    output.guidance,
  ].join("\n\n");
}

export const searchSlideImagesTool: ToolDefinition<
  typeof searchSlideImagesSchema,
  SearchSlideImagesOutput
> = {
  name: "SearchSlideImages",
  description:
    "为指定幻灯片主动搜索可用图片候选，自动开启 include_images、优先免费图库，并给出可本地化后嵌入页面 SVG 的素材参数。"
    + "当 visualAssetAudit 报告缺图，或页面需要照片/证据配图时调用。",
  category: "core",
  loadPolicy: "core",
  inputSchema: searchSlideImagesSchema,
  examples: [
    JSON.stringify({ slideId: "slide-3" }),
    JSON.stringify({ slideId: "slide-5", query: "industrial robot assembly line", visualKind: "evidence" }),
  ],
  behavior: {
    concurrency: { mode: "parallel" },
    presentation: {
      allowedCapabilities: ["create", "edit", "restyle"],
    },
  },
  risk: "low",
  permission: {
    profile: "web-search",
    description: "Search image candidates for a presentation slide.",
    scopes: ["main"],
    effects: ["network.access"],
    sandbox: "none",
    approval: "never",
  },
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) {
      throw new Error(`Slide '${args.slideId}' was not found.`);
    }

    const slots = listLayoutSlots(slide.layout ?? "", slide.grammarVariant);
    const usedSlots = new Set(slide.elements
      .filter((element) => element.type === "image")
      .map((element) => element.imageSlot)
      .filter((slot): slot is string => Boolean(slot)));
    const slot = args.slot && slots.includes(args.slot)
      ? args.slot
      : slots.find((candidate) => !usedSlots.has(candidate)) ?? slots[0];
    const search = await imageSearchService.search({
      brief: args.query?.trim() || slide.title,
      maxImages: args.maxImages,
      sourceMode: args.sourceMode,
      visualKind: args.visualKind,
    }, {
      gatewayConfig: context.gateway?.getGatewayConfig?.(),
      signal: context.signal,
    });
    const { query, rawSearch } = search;
    const aspectRatio = aspectRatioForSlot(slide, slot);
    const usedImageUrls = new Set(context.presentation.slides.flatMap((item) => item.elements
      .filter((element) => element.type === "image")
      .map((element) => element.url)));
    const rankedImages = search.candidates
      .filter((image) => !usedImageUrls.has(image.url))
      .sort((left, right) =>
        Number(Boolean(right.sourcePageUrl)) - Number(Boolean(left.sourcePageUrl))
        || left.candidateIndex - right.candidateIndex
      );
    const candidates = rankedImages.slice(0, args.maxImages).map((image, index): SlideImageCandidate => {
      const sourcePageUrl = image.sourcePageUrl;
      const provider = image.provider;
      const description = image.description || `${slide.title} image candidate ${index + 1}`;
      return {
        candidateId: `${slide.id}:image-${index + 1}`,
        url: image.url,
        description,
        provider,
        sourcePageUrl,
        licenseStatus: "unknown",
        assetArgs: {
          slideId: slide.id,
          url: image.url,
          ...(slot ? { slot } : {}),
          aspectRatio,
          objectFit: "cover",
          ...(provider ? { provider } : {}),
          ...(sourcePageUrl ? { sourcePageUrl } : {}),
          description,
        },
      };
    });

    return {
      slideId: slide.id,
      query,
      slot,
      candidates,
      guidance: slot
        ? "Choose one semantically relevant candidate, localize it into the workspace assets, and embed it in the page SVG (then PreviewSvgPage). Keep source metadata; license may stay unset when unverified, but retain the warning and never claim commercial clearance."
        : "This page has no image slot in its current layout metadata. Embed the image directly in the page SVG composition instead of relying on a grammar slot.",
      rawSearch,
    };
  },
  mapResultToModelContent: formatSearchSlideImagesOutput,
};
