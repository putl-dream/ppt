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

export function auditPresentationVisualAssets(
  presentation: Presentation,
): PresentationVisualAssetAudit {
  const imageUrlCounts = new Map<string, number>();
  let totalImageCount = 0;
  let imageSlideCount = 0;

  const slides = presentation.slides.map((slide): SlideVisualAssetAudit => {
    if (slide.visualSource?.kind === "svg") {
      const resources = slide.visualSource.resources;
      totalImageCount += resources.length;
      if (resources.length > 0) imageSlideCount += 1;
      for (const resource of resources) {
        imageUrlCounts.set(resource.sourcePath, (imageUrlCounts.get(resource.sourcePath) ?? 0) + 1);
      }
      return {
        slideId: slide.id,
        title: slide.title,
        status: resources.length > 0 ? "satisfied" : "not-needed",
        existingImageCount: resources.length,
        availableSlots: [],
        reason: "The complete SVG page owns its visual composition and embedded raster resources.",
      };
    }

    return auditNonSvgSlide(slide);
  });

  const duplicateImageUrls = [...imageUrlCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([url]) => url);
  const missingRequiredCount = slides.filter((slide) => slide.status === "missing-required").length;
  const missingRecommendedCount = slides.filter(
    (slide) => slide.status === "missing-recommended",
  ).length;

  return {
    slides,
    imageSlideCount,
    totalImageCount,
    missingRequiredCount,
    missingRecommendedCount,
    duplicateImageUrls,
    nextAction:
      missingRequiredCount + missingRecommendedCount > 0
        ? "For each missing slide, call SearchSlideImages with slideId, localize a selected candidate into the workspace, and embed it in the page SVG. Do not reuse the same image URL."
        : duplicateImageUrls.length > 0
          ? "Replace duplicate image URLs with unique, slide-specific visuals."
          : "No immediate image-search action is required.",
  };
}

function auditNonSvgSlide(slide: Slide): SlideVisualAssetAudit {
  return {
    slideId: slide.id,
    title: slide.title,
    status: "not-needed",
    existingImageCount: 0,
    availableSlots: [],
    reason: "Slide is not SVG-native; element-IR asset audit has been removed.",
  };
}
