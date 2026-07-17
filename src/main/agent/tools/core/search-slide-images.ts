import { z } from "zod";
import { getLayoutSlotRect, listLayoutSlots } from "@shared/layout-slots";
import {
  executeWebSearch,
  type WebSearchOutput,
} from "../../search/web-search";
import type { ToolDefinition } from "../tool-definition";

const FREE_IMAGE_DOMAINS = [
  "pexels.com",
  "pixabay.com",
  "unsplash.com",
  "commons.wikimedia.org",
] as const;

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
  insertArgs: {
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

function providerFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("pexels")) return "Pexels";
    if (host.includes("pixabay")) return "Pixabay";
    if (host.includes("unsplash")) return "Unsplash";
    if (host.includes("wikimedia")) return "Wikimedia Commons";
    return host.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function aspectRatioForSlot(
  layout: string,
  slot: string | undefined,
  grammarVariant: string | undefined,
): "16:9" | "4:3" | "1:1" | "auto" {
  if (!slot) return "auto";
  const rect = getLayoutSlotRect(layout, slot, "auto", grammarVariant);
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
      `   InsertSlideImage args: ${JSON.stringify(candidate.insertArgs)}`,
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
    "为指定幻灯片主动搜索可用图片候选，自动开启 include_images、优先免费图库并生成可直接传给 InsertSlideImage 的参数。"
    + "当 visualAssetAudit 报告缺图，或使用 image-grid、case/evidence、editorial-hero 时必须调用。",
  category: "core",
  loadPolicy: "core",
  inputSchema: searchSlideImagesSchema,
  examples: [
    JSON.stringify({ slideId: "slide-3" }),
    JSON.stringify({ slideId: "slide-5", query: "industrial robot assembly line", visualKind: "evidence" }),
  ],
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
    const kindPhrase = {
      photo: "professional editorial photography",
      illustration: "high quality editorial illustration",
      evidence: "documentary evidence photography",
      logo: "official logo transparent background",
    }[args.visualKind];
    const query = `${args.query?.trim() || slide.title} ${kindPhrase} landscape no text`;
    const rawSearch = await executeWebSearch({
      query,
      max_results: Math.max(3, args.maxImages),
      search_depth: "basic",
      topic: "general",
      include_images: true,
      max_images: args.maxImages,
      ...(args.sourceMode === "free" ? { allowed_domains: [...FREE_IMAGE_DOMAINS] } : {}),
    }, {
      gatewayConfig: context.gateway?.getGatewayConfig?.(),
      signal: context.signal,
    });
    const aspectRatio = aspectRatioForSlot(slide.layout ?? "", slot, slide.grammarVariant);
    const usedImageUrls = new Set(context.presentation.slides.flatMap((item) => item.elements
      .filter((element) => element.type === "image")
      .map((element) => element.url)));
    const rankedImages = [...rawSearch.images]
      .filter((image) => !usedImageUrls.has(image.url))
      .sort((left, right) => Number(Boolean(right.sourceUrl)) - Number(Boolean(left.sourceUrl)));
    const candidates = rankedImages.slice(0, args.maxImages).map((image, index): SlideImageCandidate => {
      const sourcePageUrl = image.sourceUrl;
      const provider = providerFromUrl(sourcePageUrl ?? image.url);
      const description = image.description || `${slide.title} image candidate ${index + 1}`;
      return {
        candidateId: `${slide.id}:image-${index + 1}`,
        url: image.url,
        description,
        provider,
        sourcePageUrl,
        licenseStatus: "unknown",
        insertArgs: {
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
        ? "Choose one semantically relevant candidate and call InsertSlideImage directly. Keep source metadata; license may stay unset when unverified, but retain the warning and never claim commercial clearance."
        : "This layout has no image slot. Change to an image-capable layout/grammar before insertion.",
      rawSearch,
    };
  },
  mapResultToModelContent: formatSearchSlideImagesOutput,
};
