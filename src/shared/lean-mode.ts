import {
  DESIGN_PRESETS,
  resolveSlideStyle,
  type DesignSystemV1,
} from "@design-system";
import { z } from "zod";

import { applyLayout } from "./layout";
import type { PresentationCommand } from "./commands";
import {
  presentationSchema,
  type ChartElement,
  type Presentation,
  type Slide,
  type SlideElement,
  type TextElement,
} from "./presentation";
import type { SlideLayoutType } from "./slide-layouts";

export {
  LEAN_GENERATION_MODES,
  leanGenerationModeSchema,
  type LeanGenerationMode,
  type LeanRunMetrics,
} from "./lean-mode-contract";

export const LEAN_DECK_SCENARIOS = [
  "internal-report",
  "sales-proposal",
  "investor-pitch",
] as const;

export const LEAN_SLIDE_PURPOSES = [
  "opening",
  "navigation",
  "context",
  "problem",
  "insight",
  "solution",
  "proof",
  "plan",
  "ask",
  "close",
] as const;

export const LEAN_SLIDE_KINDS = [
  "cover",
  "agenda",
  "section",
  "bullets",
  "comparison",
  "process",
  "metric",
  "chart",
  "closing",
] as const;

const leanContentItemSchema = z.object({
  heading: z.string().trim().min(1).max(40),
  detail: z.string().trim().max(80),
}).strict();

const leanColumnSchema = z.object({
  label: z.string().trim().min(1).max(30),
  items: z.array(z.string().trim().min(1).max(60)).min(1).max(4),
}).strict();

const leanMetricSchema = z.object({
  value: z.string().trim().min(1).max(24),
  label: z.string().trim().min(1).max(40),
  takeaway: z.string().trim().min(1).max(90),
}).strict();

const leanChartSchema = z.object({
  chartType: z.enum(["bar", "h-bar", "timeline", "kpi-tower"]),
  unit: z.string().trim().max(20),
  items: z.array(z.object({
    label: z.string().trim().min(1).max(30),
    value: z.number().finite(),
  }).strict()).min(2).max(8),
  takeaway: z.string().trim().min(1).max(90),
}).strict();

export const leanSourceSpecSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  asOf: z.string().trim().max(30).nullable(),
  provenance: z.enum(["user", "illustrative"]),
}).strict();

/**
 * Flat on purpose: every property is required, while unused branches use
 * empty arrays/strings or null. This stays compatible with strict structured
 * output implementations across providers.
 */
export const leanSlideSpecSchema = z.object({
  kind: z.enum(LEAN_SLIDE_KINDS),
  purpose: z.enum(LEAN_SLIDE_PURPOSES),
  title: z.string().trim().min(1).max(48),
  subtitle: z.string().trim().max(100),
  items: z.array(leanContentItemSchema).max(6),
  left: leanColumnSchema.nullable(),
  right: leanColumnSchema.nullable(),
  steps: z.array(leanContentItemSchema).max(5),
  metric: leanMetricSchema.nullable(),
  chart: leanChartSchema.nullable(),
  sourceRefs: z.array(z.string().trim().min(1).max(40)).max(6),
}).strict().superRefine((slide, context) => {
  const requirePurpose = (allowed: readonly string[]) => {
    if (!allowed.includes(slide.purpose)) {
      context.addIssue({
        code: "custom",
        path: ["purpose"],
        message: `${slide.kind} slide cannot use purpose '${slide.purpose}'.`,
      });
    }
  };

  if (slide.kind === "cover") {
    requirePurpose(["opening"]);
    if (!slide.subtitle) {
      context.addIssue({
        code: "custom",
        path: ["subtitle"],
        message: "Cover slide requires a subtitle.",
      });
    }
  } else if (slide.kind === "agenda") {
    requirePurpose(["navigation"]);
    if (slide.items.length < 3 || slide.items.length > 6) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Agenda slide requires 3 to 6 items.",
      });
    }
  } else if (slide.kind === "section") {
    requirePurpose(["navigation"]);
  } else if (slide.kind === "bullets") {
    requirePurpose(["context", "problem", "insight", "solution", "proof", "plan", "ask"]);
    if (slide.items.length < 2 || slide.items.length > 4) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Bullets slide requires 2 to 4 items.",
      });
    }
  } else if (slide.kind === "comparison") {
    requirePurpose(["context", "problem", "insight", "solution", "proof", "plan", "ask"]);
    if (!slide.left || !slide.right) {
      context.addIssue({
        code: "custom",
        path: ["left"],
        message: "Comparison slide requires both left and right columns.",
      });
    }
  } else if (slide.kind === "process") {
    requirePurpose(["solution", "plan"]);
    if (slide.steps.length < 2 || slide.steps.length > 5) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Process slide requires 2 to 5 steps.",
      });
    }
  } else if (slide.kind === "metric") {
    requirePurpose(["proof", "insight"]);
    if (!slide.metric) {
      context.addIssue({
        code: "custom",
        path: ["metric"],
        message: "Metric slide requires metric content.",
      });
    }
    if (slide.sourceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceRefs"],
        message: "Metric slide requires at least one visible source reference.",
      });
    }
  } else if (slide.kind === "chart") {
    requirePurpose(["proof", "insight"]);
    if (!slide.chart) {
      context.addIssue({
        code: "custom",
        path: ["chart"],
        message: "Chart slide requires chart content.",
      });
    }
    if (slide.sourceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceRefs"],
        message: "Chart slide requires at least one visible source reference.",
      });
    }
  } else if (slide.kind === "closing") {
    requirePurpose(["close"]);
    if (!slide.subtitle) {
      context.addIssue({
        code: "custom",
        path: ["subtitle"],
        message: "Closing slide requires a takeaway.",
      });
    }
    if (slide.items.length < 1 || slide.items.length > 3) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Closing slide requires 1 to 3 actions.",
      });
    }
  }

  const visibleTextLength = slide.title.length
    + slide.subtitle.length
    + slide.items.reduce((sum, item) => sum + item.heading.length + item.detail.length, 0)
    + slide.steps.reduce((sum, item) => sum + item.heading.length + item.detail.length, 0)
    + (slide.left?.items.join("").length ?? 0)
    + (slide.right?.items.join("").length ?? 0)
    + (slide.metric
      ? slide.metric.value.length + slide.metric.label.length + slide.metric.takeaway.length
      : 0)
    + (slide.chart ? slide.chart.takeaway.length : 0);
  if (visibleTextLength > 260) {
    context.addIssue({
      code: "custom",
      message: `Slide visible text is too dense (${visibleTextLength} characters; maximum 260).`,
    });
  }
});

export const leanDeckSpecSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(80),
  locale: z.enum(["zh-CN", "en-US"]),
  scenario: z.enum(LEAN_DECK_SCENARIOS),
  audience: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(140),
  desiredAction: z.string().trim().min(1).max(120),
  durationMinutes: z.number().int().min(5).max(30),
  designPreset: z.enum(["business", "report", "technical"]),
  sources: z.array(leanSourceSpecSchema).max(12),
  slides: z.array(leanSlideSpecSchema).min(6).max(12),
}).strict().superRefine((deck, context) => {
  const sourceIds = new Set<string>();
  deck.sources.forEach((source, index) => {
    if (sourceIds.has(source.id)) {
      context.addIssue({
        code: "custom",
        path: ["sources", index, "id"],
        message: `Duplicate source id '${source.id}'.`,
      });
    }
    sourceIds.add(source.id);
  });

  if (deck.slides[0]?.kind !== "cover") {
    context.addIssue({
      code: "custom",
      path: ["slides", 0, "kind"],
      message: "The first slide must be a cover.",
    });
  }
  if (deck.slides.at(-1)?.kind !== "closing") {
    context.addIssue({
      code: "custom",
      path: ["slides", deck.slides.length - 1, "kind"],
      message: "The last slide must be a closing slide.",
    });
  }

  const coverCount = deck.slides.filter((slide) => slide.kind === "cover").length;
  const closingCount = deck.slides.filter((slide) => slide.kind === "closing").length;
  const agendaCount = deck.slides.filter((slide) => slide.kind === "agenda").length;
  const sectionCount = deck.slides.filter((slide) => slide.kind === "section").length;
  if (coverCount !== 1) {
    context.addIssue({ code: "custom", path: ["slides"], message: "Deck requires exactly one cover." });
  }
  if (closingCount !== 1) {
    context.addIssue({ code: "custom", path: ["slides"], message: "Deck requires exactly one closing slide." });
  }
  if (deck.slides.length >= 9 && agendaCount !== 1) {
    context.addIssue({
      code: "custom",
      path: ["slides"],
      message: "Decks with 9 or more slides require exactly one agenda.",
    });
  }
  if (deck.slides.length < 9 && agendaCount > 1) {
    context.addIssue({
      code: "custom",
      path: ["slides"],
      message: "Decks under 9 slides may contain at most one agenda.",
    });
  }
  if (deck.slides.length >= 10 && (sectionCount < 1 || sectionCount > 2)) {
    context.addIssue({
      code: "custom",
      path: ["slides"],
      message: "Decks with 10 or more slides require 1 to 2 section dividers.",
    });
  }
  if (sectionCount > 2) {
    context.addIssue({
      code: "custom",
      path: ["slides"],
      message: "Deck may contain at most two section dividers.",
    });
  }

  deck.slides.forEach((slide, slideIndex) => {
    slide.sourceRefs.forEach((sourceRef, sourceIndex) => {
      if (!sourceIds.has(sourceRef)) {
        context.addIssue({
          code: "custom",
          path: ["slides", slideIndex, "sourceRefs", sourceIndex],
          message: `Unknown source reference '${sourceRef}'.`,
        });
      }
    });
    if (
      slideIndex >= 2
      && slide.kind === "bullets"
      && deck.slides[slideIndex - 1]?.kind === "bullets"
      && deck.slides[slideIndex - 2]?.kind === "bullets"
    ) {
      context.addIssue({
        code: "custom",
        path: ["slides", slideIndex, "kind"],
        message: "Do not use three consecutive bullets slides.",
      });
    }
  });

  const purposes = deck.slides.map((slide) => slide.purpose);
  const requiredPurposes: Record<(typeof LEAN_DECK_SCENARIOS)[number], string[]> = {
    "internal-report": ["context", "proof", "plan", "close"],
    "sales-proposal": ["problem", "solution", "proof", "ask", "close"],
    "investor-pitch": ["problem", "solution", "proof", "close"],
  };
  for (const purpose of requiredPurposes[deck.scenario]) {
    if (!purposes.includes(purpose as (typeof LEAN_SLIDE_PURPOSES)[number])) {
      context.addIssue({
        code: "custom",
        path: ["slides"],
        message: `${deck.scenario} deck is missing required purpose '${purpose}'.`,
      });
    }
  }
  if (
    deck.scenario === "investor-pitch"
    && purposes.filter((purpose) => purpose === "proof").length < 2
  ) {
    context.addIssue({
      code: "custom",
      path: ["slides"],
      message: "Investor pitch requires at least two proof slides.",
    });
  }
  if (
    deck.scenario === "investor-pitch"
    && !purposes.some((purpose) => purpose === "plan" || purpose === "ask")
  ) {
    context.addIssue({
      code: "custom",
      path: ["slides"],
      message: "Investor pitch requires a plan or ask slide.",
    });
  }

  const layoutKinds = new Set(deck.slides.map((slide) => slide.kind));
  const minimumKinds = deck.slides.length >= 10 ? 5 : deck.slides.length >= 8 ? 4 : 3;
  if (layoutKinds.size < minimumKinds) {
    context.addIssue({
      code: "custom",
      path: ["slides"],
      message: `Deck requires at least ${minimumKinds} distinct slide kinds.`,
    });
  }
});

export type LeanDeckSpec = z.infer<typeof leanDeckSpecSchema>;
export type LeanSlideSpec = z.infer<typeof leanSlideSpecSchema>;

export interface CompiledLeanDeck {
  presentation: Presentation;
  commands: PresentationCommand[];
}

const KIND_LAYOUT: Record<LeanSlideSpec["kind"], SlideLayoutType> = {
  cover: "cover",
  agenda: "toc",
  section: "section",
  bullets: "concept",
  comparison: "comparison",
  process: "process",
  metric: "case",
  chart: "case",
  closing: "summary",
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableId(kind: string, ...parts: unknown[]): string {
  return `lean-${kind}-${stableHash(JSON.stringify(parts))}`;
}

function textElement(
  seed: string,
  text: string,
  fontSize = 22,
): TextElement {
  return {
    id: stableId("text", seed),
    type: "text",
    provenance: "agent",
    x: 120,
    y: 188,
    width: 1040,
    height: 120,
    text,
    fontSize,
  };
}

function itemText(item: z.infer<typeof leanContentItemSchema>): string {
  return item.detail ? `${item.heading}\n${item.detail}` : item.heading;
}

function withSubtitle(slide: LeanSlideSpec, text: string): string {
  return slide.subtitle
    ? `${slide.subtitle}\n${text}`
    : text;
}

function sourceFooter(
  slide: LeanSlideSpec,
  deck: LeanDeckSpec,
  seed: string,
  color: string,
): TextElement | undefined {
  if (slide.sourceRefs.length === 0) return undefined;
  const sourcesById = new Map(deck.sources.map((source) => [source.id, source]));
  const labels = slide.sourceRefs.flatMap((sourceRef) => {
    const source = sourcesById.get(sourceRef);
    if (!source) return [];
    const label = source.provenance === "illustrative"
      ? `${source.label}（示意数据）`
      : source.label;
    return [source.asOf ? `${label}，截至 ${source.asOf}` : label];
  });
  if (labels.length === 0) return undefined;
  return {
    id: stableId("source", seed),
    type: "text",
    provenance: "agent",
    x: 120,
    y: 652,
    width: 1040,
    height: 28,
    text: `来源：${labels.join("；")}`,
    fontSize: 14,
    color,
    align: "left",
    textRole: "caption",
  };
}

function createRawElements(slide: LeanSlideSpec, slideIndex: number): SlideElement[] {
  const seed = `${slideIndex}:${slide.kind}:${slide.title}`;
  if (slide.kind === "cover" || slide.kind === "section") {
    return [
      textElement(`${seed}:title`, slide.title, 56),
      ...(slide.subtitle ? [textElement(`${seed}:subtitle`, slide.subtitle, 24)] : []),
    ];
  }
  if (slide.kind === "agenda" || slide.kind === "bullets" || slide.kind === "closing") {
    const content = slide.kind === "closing"
      ? [
          { heading: slide.subtitle, detail: "" },
          ...slide.items,
        ]
      : slide.items;
    return content.map((item, index) => {
      const text = itemText(item);
      return textElement(
        `${seed}:item:${index}`,
        slide.kind !== "closing" && index === 0
          ? withSubtitle(slide, text)
          : text,
        22,
      );
    });
  }
  if (slide.kind === "comparison" && slide.left && slide.right) {
    return [
      textElement(`${seed}:left:label`, withSubtitle(slide, slide.left.label), 22),
      textElement(`${seed}:right:label`, slide.right.label, 22),
      textElement(`${seed}:left:items`, slide.left.items.map((item) => `• ${item}`).join("\n"), 20),
      textElement(`${seed}:right:items`, slide.right.items.map((item) => `• ${item}`).join("\n"), 20),
    ];
  }
  if (slide.kind === "process") {
    return slide.steps.map((step, index) => {
      const text = itemText(step);
      return textElement(
        `${seed}:step:${index}`,
        index === 0 ? withSubtitle(slide, text) : text,
        20,
      );
    });
  }
  if (slide.kind === "metric" && slide.metric) {
    return [
      textElement(`${seed}:takeaway`, withSubtitle(slide, slide.metric.takeaway), 20),
      {
        ...textElement(`${seed}:metric`, `${slide.metric.value}\n${slide.metric.label}`, 44),
        textRole: "metric",
      },
    ];
  }
  if (slide.kind === "chart" && slide.chart) {
    const chart: ChartElement = {
      id: stableId("chart", seed),
      type: "chart",
      provenance: "agent",
      x: 784,
      y: 212,
      width: 352,
      height: 400,
      chartType: slide.chart.chartType,
      data: { items: slide.chart.items },
      unit: slide.chart.unit || undefined,
    };
    return [
      textElement(`${seed}:takeaway`, withSubtitle(slide, slide.chart.takeaway), 20),
      chart,
    ];
  }
  return [];
}

export function createLeanSlideContentElements(
  slide: LeanSlideSpec,
  deck: LeanDeckSpec,
  slideIndex: number,
  sourceColor: string,
): SlideElement[] {
  const slideSeed = `${deck.title}:${slideIndex}:${slide.kind}:${slide.title}`;
  const footer = sourceFooter(slide, deck, slideSeed, sourceColor);
  return footer
    ? [...createRawElements(slide, slideIndex), footer]
    : createRawElements(slide, slideIndex);
}

function normalizeElementIds(elements: SlideElement[], slideSeed: string): SlideElement[] {
  return elements.map((element, index) => ({
    ...element,
    id: stableId("element", slideSeed, index, element.type),
  }));
}

function resolveLeanDesignSystem(
  deck: LeanDeckSpec,
  override?: DesignSystemV1,
): DesignSystemV1 {
  if (override) return structuredClone(override);
  const preset = DESIGN_PRESETS.find((candidate) => candidate.id === deck.designPreset);
  if (!preset) {
    throw new Error(`Unknown Lean design preset '${deck.designPreset}'.`);
  }
  return structuredClone(preset.system);
}

export function isLeanStarterPresentation(presentation: Presentation): boolean {
  if (presentation.slides.length === 0) return true;
  if (presentation.slides.length !== 1) return false;
  const slide = presentation.slides[0];
  return slide.title === "Opening"
    && slide.elements.length === 1
    && slide.elements[0]?.type === "text"
    && slide.elements[0].text.trim() === "Agent PPT";
}

export function compileLeanDeckSpec(
  input: LeanDeckSpec,
  basePresentation: Presentation,
  designSystemOverride?: DesignSystemV1,
): CompiledLeanDeck {
  const deck = leanDeckSpecSchema.parse(input);
  if (!isLeanStarterPresentation(basePresentation)) {
    throw new Error("Lean Mode v1 仅支持新建 PPT。请新建会话后再使用，已有正式稿不会被覆盖。");
  }

  const designSystem = resolveLeanDesignSystem(deck, designSystemOverride);
  const slides = deck.slides.map((slideSpec, slideIndex): Slide => {
    const slideSeed = `${deck.title}:${slideIndex}:${slideSpec.kind}:${slideSpec.title}`;
    const rawSlide: Slide = {
      id: stableId("slide", slideSeed),
      title: slideSpec.title,
      elements: createRawElements(slideSpec, slideIndex),
    };
    const layout = KIND_LAYOUT[slideSpec.kind];
    const grammarVariant = slideSpec.kind === "cover"
      ? "editorial-hero"
      : slideSpec.kind === "metric"
        ? "metric-focus"
        : slideSpec.kind === "chart"
          ? "split"
          : undefined;
    const style = resolveSlideStyle(designSystem, rawSlide);
    const laidOut = applyLayout(rawSlide, layout, style, { grammarVariant });
    const footer = sourceFooter(slideSpec, deck, slideSeed, style.colors.body);
    return {
      ...laidOut,
      elements: normalizeElementIds(
        footer ? [...laidOut.elements, footer] : laidOut.elements,
        slideSeed,
      ),
    };
  });

  const presentation = presentationSchema.parse({
    id: basePresentation.id,
    title: deck.title,
    revision: basePresentation.revision,
    designSystem,
    slides,
  });

  const commandSeed = `${basePresentation.id}:${basePresentation.revision}:${deck.title}`;
  const commands: PresentationCommand[] = [
    ...basePresentation.slides.map((slide, index): PresentationCommand => ({
      id: stableId("command", commandSeed, "remove-slide", index),
      type: "remove-slide",
      slideId: slide.id,
    })),
    {
      id: stableId("command", commandSeed, "set-title"),
      type: "set-presentation-title",
      title: deck.title,
    },
    {
      id: stableId("command", commandSeed, "set-design-system"),
      type: "set-design-system",
      designSystem,
    },
    ...slides.map((slide, index): PresentationCommand => ({
      id: stableId("command", commandSeed, "add-slide", index),
      type: "add-slide",
      slide,
      index,
    })),
  ];

  return { presentation, commands };
}
