import { listLayoutSlots } from "./layout-slots";
import type { Presentation, Slide } from "./presentation";

export type VisualAssetStatus =
  | "missing-required"
  | "missing-recommended"
  | "satisfied"
  | "not-needed";

export interface SlideVisualAssetAudit {
  slideId: string;
  title: string;
  status: VisualAssetStatus;
  existingImageCount: number;
  availableSlots: string[];
  suggestedSlot?: string;
  suggestedQuery?: string;
  reason: string;
}

export interface PresentationVisualAssetAudit {
  slides: SlideVisualAssetAudit[];
  imageSlideCount: number;
  totalImageCount: number;
  missingRequiredCount: number;
  missingRecommendedCount: number;
  duplicateImageUrls: string[];
  nextAction: string;
}

function visualRequirement(slide: Slide): {
  minimum: number;
  level: "required" | "recommended" | "none";
  reason: string;
} {
  if (slide.layout === "image-grid") {
    return {
      minimum: slide.grammarVariant === "hero-caption" ? 1 : 2,
      level: "required",
      reason: "image-grid 是图片主导版式，必须填充真实且互不重复的图片。",
    };
  }
  if (slide.layout === "case" && slide.grammarVariant === "evidence") {
    return {
      minimum: 1,
      level: "required",
      reason: "case/evidence 需要图片证据，否则应改用 split 或 metric-focus。",
    };
  }
  if (slide.layout === "cover" && slide.grammarVariant === "editorial-hero") {
    return {
      minimum: 1,
      level: "recommended",
      reason: "editorial-hero 使用主视觉能形成更明确的开场锚点。",
    };
  }
  if (slide.layout === "section" && slide.grammarVariant === "editorial-split") {
    return {
      minimum: 1,
      level: "recommended",
      reason: "editorial-split 预留了章节主视觉区域。",
    };
  }
  return { minimum: 0, level: "none", reason: "当前版式不强制依赖图片。" };
}

function preferredSlot(slide: Slide, availableSlots: string[]): string | undefined {
  const used = new Set(slide.elements
    .filter((element) => element.type === "image")
    .map((element) => element.imageSlot)
    .filter((slot): slot is string => Boolean(slot)));
  const preferred = slide.layout === "image-grid" && slide.grammarVariant === "hero-caption"
    ? "hero"
    : availableSlots.find((slot) => !used.has(slot));
  return preferred && availableSlots.includes(preferred) ? preferred : availableSlots[0];
}

export function auditPresentationVisualAssets(
  presentation: Presentation,
): PresentationVisualAssetAudit {
  const imageUrlCounts = new Map<string, number>();
  let totalImageCount = 0;
  let imageSlideCount = 0;

  const slides = presentation.slides.map((slide): SlideVisualAssetAudit => {
    const images = slide.elements.filter((element) => element.type === "image");
    totalImageCount += images.length;
    if (images.length > 0) imageSlideCount += 1;
    for (const image of images) {
      if (image.url) imageUrlCounts.set(image.url, (imageUrlCounts.get(image.url) ?? 0) + 1);
    }

    const requirement = visualRequirement(slide);
    const availableSlots = listLayoutSlots(slide.layout ?? "", slide.grammarVariant);
    const missing = Math.max(0, requirement.minimum - images.length);
    const status: VisualAssetStatus = missing === 0
      ? requirement.level === "none" ? "not-needed" : "satisfied"
      : requirement.level === "required" ? "missing-required" : "missing-recommended";
    const shouldSearch = status === "missing-required" || status === "missing-recommended";

    return {
      slideId: slide.id,
      title: slide.title,
      status,
      existingImageCount: images.length,
      availableSlots,
      ...(shouldSearch ? {
        suggestedSlot: preferredSlot(slide, availableSlots),
        suggestedQuery: `${slide.title} professional editorial photography landscape no text`,
      } : {}),
      reason: requirement.reason,
    };
  });

  const duplicateImageUrls = [...imageUrlCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([url]) => url);
  const missingRequiredCount = slides.filter((slide) => slide.status === "missing-required").length;
  const missingRecommendedCount = slides.filter((slide) => slide.status === "missing-recommended").length;

  return {
    slides,
    imageSlideCount,
    totalImageCount,
    missingRequiredCount,
    missingRecommendedCount,
    duplicateImageUrls,
    nextAction: missingRequiredCount + missingRecommendedCount > 0
      ? "For each missing slide, call SearchSlideImages with slideId, then call InsertSlideImage with one selected candidate. Do not reuse the same image URL."
      : duplicateImageUrls.length > 0
        ? "Replace duplicate image URLs with unique, slide-specific visuals."
        : "No immediate image-search action is required.",
  };
}
