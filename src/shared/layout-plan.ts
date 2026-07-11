import { z } from "zod";

import { validateDeckRhythm, type DeckRhythmIssue } from "./deck-rhythm";
import { designTokensV1Schema, resolveDesignTokens } from "./design-tokens";
import { SLIDE_LAYOUTS } from "./slide-layouts";
import { SLIDE_VARIANTS } from "./slide-variant";
import type { PresentationCommand } from "./commands";
import type { Presentation } from "./presentation";

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

export const STYLE_MODES = ["template", "creative"] as const;

export const layoutPlanEnhancementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("beautify-chart"),
    chartType: z.enum(["bar", "h-bar", "timeline", "kpi-tower"]).optional(),
  }),
  z.object({ type: z.literal("beautify-table") }),
  z.object({
    type: z.literal("insert-image"),
    slot: z.string(),
    url: z.string(),
    aspectRatio: z.enum(["16:9", "4:3", "1:1"]).optional(),
    provider: z.string().optional(),
    sourcePageUrl: z.string().url().optional(),
    description: z.string().optional(),
    attribution: z.string().optional(),
    license: z.string().optional(),
  }),
  z.object({
    type: z.literal("add-decorations"),
    mode: z.enum(["creative"]).optional(),
  }),
  z.object({
    type: z.literal("add-icon"),
    name: z.string(),
  }),
]);

export const layoutPlanSlideSchema = z.object({
  slideId: z.string(),
  title: z.string(),
  narrativeRole: z.enum(NARRATIVE_ROLES),
  layout: z.enum(SLIDE_LAYOUTS),
  grammarVariant: z.string().optional(),
  designTokens: designTokensV1Schema.optional(),
  slideVariant: z.enum(SLIDE_VARIANTS).optional(),
  rationale: z.string(),
  enhancements: z.array(layoutPlanEnhancementSchema).default([]),
});

export const layoutPlanSchema = z.object({
  version: z.literal(1).default(1),
  theme: z.enum(["nordic", "midnight", "ocean", "sunset", "purple"]),
  palette: z.enum(["cyan", "green", "purple", "orange"]),
  styleMode: z.enum(STYLE_MODES).default("template"),
  designTokens: designTokensV1Schema.optional(),
  designNotes: z.string().optional(),
  slides: z.array(layoutPlanSlideSchema).min(1),
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

  for (let i = 0; i < layouts.length - 2; i += 1) {
    const a = layouts[i];
    const b = layouts[i + 1];
    const c = layouts[i + 2];
    if (a === b && b === c) {
      issues.push({
        slideId: slides[i + 2]?.slideId,
        severity: "error",
        message: `Three consecutive '${a}' layouts in plan (Rubric A3).`,
        fixHint: "Alternate process, concept, case, or section.",
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
  }

  return issues;
}

/** Simulate deck rhythm from a layout plan (pre-execution check). */
export function validateLayoutPlanRhythm(plan: LayoutPlan): DeckRhythmIssue[] {
  const pseudoPresentation = {
    id: "layout-plan-check",
    title: "Layout Plan Check",
    revision: 0,
    theme: plan.theme,
    palette: plan.palette,
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
  const commands: PresentationCommand[] = [
    {
      id: `cmd-theme-${plan.theme}`,
      type: "set-theme",
      theme: plan.theme,
      palette: plan.palette,
    },
  ];

  for (const slide of plan.slides) {
    const designTokens = slide.designTokens ??
      (plan.designTokens ? resolveDesignTokens(plan.designTokens) : undefined);
    commands.push({
      id: `cmd-layout-${slide.slideId}`,
      type: "update-slide-layout",
      slideId: slide.slideId,
      layout: slide.layout,
      grammarVariant: slide.grammarVariant,
      designTokens,
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
