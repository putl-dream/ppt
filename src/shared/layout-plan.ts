import { z } from "zod";

import { validateDeckRhythm, type DeckRhythmIssue } from "./deck-rhythm";
import { slideDesignOverrideSchema } from "@design-system";
import { SLIDE_LAYOUTS } from "./slide-layouts";
import { getSupportedGrammarVariants } from "./layout-grammar-variants";
import { listLayoutSlots } from "./layout-slots";
import { SLIDE_VARIANTS } from "./slide-variant";
import type { PresentationCommand } from "./commands";
import { imageSourceSchema, type Presentation } from "./presentation";
import { PAGE_RHYTHMS } from "./design-capability";
import {
  confirmedDesignSelectionBaseSchema,
  getSelectedDesignDirection,
  validateDesignDirectionSelection,
  type CommunicationContract,
  type DesignDirection,
} from "./design-plan";

export {
  communicationContractSchema,
  designDirectionSchema,
  DESIGN_SELECTION_SOURCES,
  getSelectedDesignDirection,
} from "./design-plan";
export type { CommunicationContract, DesignDirection } from "./design-plan";

export const LAYOUT_PLAN_PATH = "slides/layout-plan.json";

export const NARRATIVE_ROLES = [
  "cover",
  "toc",
  "section",
  "content",
  "data",
  "comparison",
  "quote",
  "summary",
] as const;

export const layoutPlanEnhancementSchema = z.object({
  type: z.literal("insert-image"),
  slot: z.string(),
  url: imageSourceSchema,
  aspectRatio: z.enum(["16:9", "4:3", "1:1"]).optional(),
  provider: z.string().optional(),
  sourcePageUrl: z.string().url().optional(),
  description: z.string().optional(),
  attribution: z.string().optional(),
  license: z.string().optional(),
});

export const layoutPlanSlideSchema = z.object({
  slideId: z.string(),
  title: z.string(),
  narrativeRole: z.enum(NARRATIVE_ROLES),
  audienceMove: z.string().trim().min(1).max(200),
  rhythm: z.enum(PAGE_RHYTHMS),
  layoutIntent: z.string().trim().min(1).max(240),
  layout: z.enum(SLIDE_LAYOUTS),
  grammarVariant: z.string().optional(),
  designOverride: slideDesignOverrideSchema.optional(),
  slideVariant: z.enum(SLIDE_VARIANTS).optional(),
  rationale: z.string(),
  enhancements: z.array(layoutPlanEnhancementSchema).default([]),
});

export const layoutPlanSchema = confirmedDesignSelectionBaseSchema.extend({
  designNotes: z.string().optional(),
  slides: z.array(layoutPlanSlideSchema).min(1),
}).strict().superRefine((plan, context) => {
  validateDesignDirectionSelection(
    plan,
    plan.selectedDirectionId,
    context,
    "selectedDirectionId",
  );
});

export type LayoutPlanEnhancement = z.infer<typeof layoutPlanEnhancementSchema>;
export type LayoutPlanSlide = z.infer<typeof layoutPlanSlideSchema>;
export type LayoutPlan = z.infer<typeof layoutPlanSchema>;

export interface LayoutPlanValidationIssue {
  slideId?: string;
  severity: "info" | "warning" | "error";
  message: string;
  fixHint?: string;
}

export function parseLayoutPlan(content: string): LayoutPlan {
  return layoutPlanSchema.parse(JSON.parse(content));
}

export function serializeLayoutPlan(plan: LayoutPlan): string {
  const normalized = layoutPlanSchema.parse(plan);
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

/** Validate a layout plan against design Rubric (A–D) before execution. */
export function validateLayoutPlan(plan: LayoutPlan): LayoutPlanValidationIssue[] {
  const issues: LayoutPlanValidationIssue[] = [];
  const slides = plan.slides;
  const count = slides.length;
  const layouts = slides.map((slide) => slide.layout);
  const slideIds = slides.map((slide) => slide.slideId);
  const uniqueIds = new Set(slideIds);

  if (uniqueIds.size !== slideIds.length) {
    issues.push({
      severity: "error",
      message: "Duplicate slideId entries in layout plan.",
      fixHint: "Each slide must have a unique slideId.",
    });
  }

  if (!layouts.includes("cover") && count >= 3) {
    issues.push({
      severity: "warning",
      message: "Layout plan has no cover slide (Rubric A1).",
      fixHint: "First slide should use layout cover.",
    });
  }

  if (count >= 5 && !layouts.includes("summary")) {
    issues.push({
      severity: "warning",
      message: "Layout plan has no summary slide (Rubric A1).",
      fixHint: "Add a summary slide at the end.",
    });
  }

  if (count >= 8 && !layouts.includes("section")) {
    issues.push({
      severity: "warning",
      message: "8+ slide plan lacks section divider (Rubric A2).",
      fixHint: "Insert section before each major chapter.",
    });
  }

  if (count >= 7 && !layouts.includes("toc")) {
    issues.push({
      severity: "info",
      message: "7+ slide business deck has no toc (Rubric anti-pattern: no toc).",
      fixHint: "Add toc as page 2.",
    });
  }

  const rhythms = slides.map((slide) => slide.rhythm);
  const uniqueRhythms = new Set(rhythms);
  if (count >= 5 && uniqueRhythms.size < 2) {
    issues.push({
      severity: "error",
      message: "A 5+ slide plan must use at least two page rhythms.",
      fixHint: "Use anchor for key claims, dense for evidence, and breathing for transitions.",
    });
  }

  for (let i = 0; i < layouts.length - 2; i += 1) {
    const window = slides.slice(i, i + 3);
    const signatures = window.map((slide) =>
      `${slide.layout}/${slide.grammarVariant ?? "default"}/${slide.rhythm}`,
    );
    if (new Set(signatures).size === 1) {
      issues.push({
        slideId: slides[i + 2]?.slideId,
        severity: "error",
        message: `Three consecutive slides repeat '${signatures[0]}' (Rubric A3).`,
        fixHint: "Change the composition, grammar, or rhythm to create a meaningful beat.",
      });
    }
    if (window.every((slide) => slide.rhythm === "dense")) {
      issues.push({
        slideId: slides[i + 2]?.slideId,
        severity: "warning",
        message: "Three consecutive dense pages create excessive cognitive load.",
        fixHint: "Introduce an anchor or breathing page, or document why the evidence sequence cannot break.",
      });
    }
  }

  const uniqueLayouts = new Set(layouts);
  const minDistinct = count >= 10 ? 5 : count >= 7 ? 3 : 0;
  if (minDistinct > 0 && uniqueLayouts.size < minDistinct) {
    issues.push({
      severity: "warning",
      message: `${count}-slide plan uses only ${uniqueLayouts.size} layouts (need ≥${minDistinct}, Rubric A4).`,
      fixHint: "Introduce case, process, comparison, toc, or section.",
    });
  }

  const variants = slides.map((slide) => slide.slideVariant).filter(Boolean);
  const uniqueVariants = new Set(variants);
  if (count >= 5 && uniqueVariants.size < 2) {
    issues.push({
      severity: "info",
      message: "Plan uses only one slideVariant (Rubric A5).",
      fixHint: "Alternate hero (cover/section), default (content), muted (quote).",
    });
  }

  const hasDataPage = layouts.some((layout) =>
    layout === "case" || layout === "process" || layout === "comparison",
  );
  if (count >= 5 && !hasDataPage) {
    issues.push({
      severity: "warning",
      message: "Plan lacks data/flow page — case, process, or comparison (Rubric C1–C2).",
      fixHint: "Use case for KPI; process for trends; comparison for A vs B.",
    });
  }

  for (const slide of slides) {
    if (slide.grammarVariant) {
      const supported = getSupportedGrammarVariants(slide.layout);
      if (!supported.includes(slide.grammarVariant)) {
        issues.push({
          slideId: slide.slideId,
          severity: "error",
          message: `Grammar variant '${slide.grammarVariant}' is not supported by layout '${slide.layout}'.`,
          fixHint: supported.length > 0
            ? `Choose one of: ${supported.join(", ")}.`
            : "Remove grammarVariant until this layout has a grammar handler.",
        });
      }
    }
    if (slide.narrativeRole === "data" && slide.layout !== "case" && slide.layout !== "process") {
      issues.push({
        slideId: slide.slideId,
        severity: "info",
        message: `Slide '${slide.title}' marked data but layout is ${slide.layout}.`,
        fixHint: "Data highlights should use case or process.",
      });
    }
    if (slide.narrativeRole === "comparison" && slide.layout !== "comparison") {
      issues.push({
        slideId: slide.slideId,
        severity: "warning",
        message: `Slide '${slide.title}' marked comparison but layout is ${slide.layout}.`,
        fixHint: "Use comparison layout for A vs B content.",
      });
    }

    const imageEnhancements = slide.enhancements;
    const validSlots = listLayoutSlots(slide.layout, slide.grammarVariant);
    const plannedSlots = imageEnhancements.map((item) => item.slot);
    if (new Set(plannedSlots).size !== plannedSlots.length) {
      issues.push({
        slideId: slide.slideId,
        severity: "error",
        message: "Multiple insert-image enhancements target the same image slot.",
        fixHint: "Use each layout image slot at most once.",
      });
    }
    for (const enhancement of imageEnhancements) {
      if (!validSlots.includes(enhancement.slot)) {
        issues.push({
          slideId: slide.slideId,
          severity: "error",
          message: `Image slot '${enhancement.slot}' is invalid for layout '${slide.layout}'.`,
          fixHint: validSlots.length > 0
            ? `Choose one of: ${validSlots.join(", ")}.`
            : "Use an image-capable layout or remove the insert-image enhancement.",
        });
      }
    }
    const minimumImages = minimumRequiredImages(slide);
    if (minimumImages > 0 && imageEnhancements.length < minimumImages) {
      issues.push({
        slideId: slide.slideId,
        severity: "warning",
        message: `${slide.layout}/${slide.grammarVariant ?? "default"} expects at least ${minimumImages} image asset(s), but the plan contains ${imageEnhancements.length}.`,
        fixHint: "Add unique insert-image enhancements, or choose a grammar/layout that does not depend on images.",
      });
    } else if (recommendsImage(slide) && imageEnhancements.length === 0) {
      issues.push({
        slideId: slide.slideId,
        severity: "info",
        message: `${slide.layout}/${slide.grammarVariant} benefits from a real visual anchor but has no planned image.`,
        fixHint: "Search one relevant hero image, or switch to a non-image grammar variant.",
      });
    }
  }

  const plannedImageUrls = slides.flatMap((slide) =>
    slide.enhancements.map((item) => item.url),
  );
  if (new Set(plannedImageUrls).size !== plannedImageUrls.length) {
    issues.push({
      severity: "warning",
      message: "The layout plan reuses the same image URL on multiple pages.",
      fixHint: "Use a unique, slide-specific image for each visual slot.",
    });
  }

  const documentModeContentLayouts = new Set(
    slides
      .filter((slide) => !["cover", "toc", "section", "summary"].includes(slide.narrativeRole))
      .map((slide) => slide.layout),
  );
  if (count >= 7 && count <= 9 && uniqueLayouts.size > 5) {
    issues.push({
      severity: "warning",
      message: `${count}-slide document-mode plan uses ${uniqueLayouts.size} layout types; 3–5 is usually enough.`,
      fixHint: "Reuse main content layouts and vary slideVariant for rhythm instead of changing every page.",
    });
  }
  if (count >= 7 && uniqueLayouts.size === count) {
    issues.push({
      severity: "warning",
      message: "Every slide uses a different layout; this can feel like a collage rather than one document.",
      fixHint: "Keep repeated content on compatible layouts and reserve distinct layouts for cover/toc/section/summary.",
    });
  }
  if (count >= 7 && documentModeContentLayouts.size > 3) {
    issues.push({
      severity: "warning",
      message: `Main content pages use ${documentModeContentLayouts.size} layout types; keep document-mode content to ≤3.`,
      fixHint: "Choose a small set of reusable content layouts, then use variants for subtle variation.",
    });
  }

  return issues;
}

function minimumRequiredImages(slide: LayoutPlanSlide): number {
  if (slide.layout === "image-grid") return slide.grammarVariant === "hero-caption" ? 1 : 2;
  if (slide.layout === "case" && slide.grammarVariant === "evidence") return 1;
  return 0;
}

function recommendsImage(slide: LayoutPlanSlide): boolean {
  return (slide.layout === "cover" && slide.grammarVariant === "editorial-hero")
    || (slide.layout === "section" && slide.grammarVariant === "editorial-split");
}

/** Validate that a layout plan is the executable counterpart of the current presentation snapshot. */
export function validateLayoutPlanAgainstPresentation(
  plan: LayoutPlan,
  presentation: Presentation,
): LayoutPlanValidationIssue[] {
  const issues: LayoutPlanValidationIssue[] = [];
  const planSlides = plan.slides;
  const snapshotSlides = presentation.slides;

  if (planSlides.length !== snapshotSlides.length) {
    issues.push({
      severity: "error",
      message: `Layout plan slide count (${planSlides.length}) does not match snapshot slide count (${snapshotSlides.length}).`,
      fixHint: "Regenerate slides/layout-plan.json from the current ReadPresentationSnapshot result.",
    });
  }

  const max = Math.max(planSlides.length, snapshotSlides.length);
  for (let index = 0; index < max; index += 1) {
    const planned = planSlides[index];
    const actual = snapshotSlides[index];
    if (!planned || !actual) continue;
    if (planned.slideId !== actual.id) {
      issues.push({
        slideId: planned.slideId,
        severity: "error",
        message: `Layout plan slide ${index + 1} targets '${planned.slideId}', but snapshot has '${actual.id}'.`,
        fixHint: "Keep layout-plan slides[] in the same order and with the same slideId values as the snapshot.",
      });
    }
    const existingImages = actual.elements.filter((element) => element.type === "image").length;
    const plannedImages = planned.enhancements.length;
    const minimumImages = minimumRequiredImages(planned);
    if (existingImages + plannedImages < minimumImages) {
      issues.push({
        slideId: planned.slideId,
        severity: "error",
        message: `Image-dependent layout '${planned.layout}/${planned.grammarVariant ?? "default"}' has ${existingImages} existing and ${plannedImages} planned image(s); ${minimumImages} required.`,
        fixHint: "Use web_search(include_images=true) and add insert-image enhancements, or change the layout grammar.",
      });
    }
  }

  if (snapshotSlides.length >= 6) {
    const existingVisualCount = snapshotSlides.reduce(
      (total, slide) => total + slide.elements.filter((element) =>
        element.type === "image" || element.type === "chart" || element.type === "table").length,
      0,
    );
    const plannedVisualCount = planSlides.reduce(
      (total, slide) => total + slide.enhancements.length,
      0,
    );
    if (existingVisualCount + plannedVisualCount === 0) {
      issues.push({
        severity: "warning",
        message: "A 6+ slide deck has no image, chart, or table visual anchors.",
        fixHint: "Plan 2–4 relevant images for concrete topics, or add charts/tables for data-heavy topics.",
      });
    }
  }

  return issues;
}

/** Simulate deck rhythm from a layout plan (pre-execution check). */
export function validateLayoutPlanRhythm(plan: LayoutPlan): DeckRhythmIssue[] {
  const selectedDirection = getSelectedDesignDirection(plan);
  const pseudoPresentation = {
    id: "layout-plan-check",
    title: "Layout Plan Check",
    revision: 0,
    designSystem: selectedDirection.designSystem,
    slides: plan.slides.map((slide) => ({
      id: slide.slideId,
      title: slide.title,
      layout: slide.layout,
      elements: [],
    })),
  };
  return validateDeckRhythm(pseudoPresentation);
}

/** Build core presentation commands from a validated layout plan (Executor step 1). */
export function buildLayoutPlanCommands(plan: LayoutPlan): PresentationCommand[] {
  const selectedDirection = getSelectedDesignDirection(plan);
  const commands: PresentationCommand[] = [
    {
      id: "cmd-design-system",
      type: "set-design-system",
      designSystem: selectedDirection.designSystem,
    },
  ];

  for (const slide of plan.slides) {
    commands.push({
      id: `cmd-layout-${slide.slideId}`,
      type: "update-slide-layout",
      slideId: slide.slideId,
      layout: slide.layout,
      grammarVariant: slide.grammarVariant,
      designOverride: slide.designOverride,
    });
    if (slide.slideVariant) {
      commands.push({
        id: `cmd-variant-${slide.slideId}`,
        type: "update-slide-variant",
        slideId: slide.slideId,
        slideVariant: slide.slideVariant,
      });
    }
  }

  return commands;
}
