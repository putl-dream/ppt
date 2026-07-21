import { z } from "zod";
import {
  COMMERCIAL_COMMUNICATION_DEFAULTS,
  commercialCommunicationSchema,
  narrativeModeSchema,
  restructurePermissionSchema,
} from "../commercial-communication";

import {
  LEAN_DECK_SCENARIOS,
  LEAN_SLIDE_KINDS,
  LEAN_SLIDE_PURPOSES,
  leanDeckSpecSchema,
  type LeanDeckSpec,
} from "../lean-mode";

export const COMMERCIAL_ROLES = [
  "hero",
  "overview",
  "evidence",
  "comparison",
  "process",
  "gallery",
  "statement",
] as const;

export const COMMERCIAL_COMPOSITIONS = [
  "full-bleed",
  "split",
  "editorial-grid",
  "image-collage",
  "metric-story",
  "minimal-statement",
] as const;

export const commercialVisualIntentV2Schema = z.object({
  role: z.enum(COMMERCIAL_ROLES),
  composition: z.enum(COMMERCIAL_COMPOSITIONS),
  imageMode: z.enum(["required", "optional", "none"]),
  assetBrief: z.string().trim().max(180),
  emphasis: z.array(z.string().trim().min(1).max(80)).min(1).max(3),
}).strict().superRefine((visual, context) => {
  if (visual.imageMode === "none" && visual.assetBrief !== "") {
    context.addIssue({
      code: "custom",
      path: ["assetBrief"],
      message: "assetBrief must be empty when imageMode is 'none'.",
    });
  }
  if (visual.imageMode !== "none" && visual.assetBrief === "") {
    context.addIssue({
      code: "custom",
      path: ["assetBrief"],
      message: "assetBrief is required when an image may be used.",
    });
  }
  if (/https?:\/\/|file:\/\//i.test(visual.assetBrief)) {
    context.addIssue({
      code: "custom",
      path: ["assetBrief"],
      message: "assetBrief must not contain a URL.",
    });
  }
});

const contentItemSchema = z.object({
  heading: z.string().trim().min(1).max(40),
  detail: z.string().trim().max(80),
}).strict();

const columnSchema = z.object({
  label: z.string().trim().min(1).max(30),
  items: z.array(z.string().trim().min(1).max(60)).min(1).max(4),
}).strict();

const metricSchema = z.object({
  value: z.string().trim().min(1).max(24),
  label: z.string().trim().min(1).max(40),
  takeaway: z.string().trim().min(1).max(90),
}).strict();

const chartSchema = z.object({
  chartType: z.enum(["bar", "h-bar", "timeline", "kpi-tower"]),
  unit: z.string().trim().max(20),
  items: z.array(z.object({
    label: z.string().trim().min(1).max(30),
    value: z.number().finite(),
  }).strict()).min(2).max(8),
  takeaway: z.string().trim().min(1).max(90),
}).strict();

export const leanSlideSpecV2Schema = z.object({
  kind: z.enum(LEAN_SLIDE_KINDS),
  purpose: z.enum(LEAN_SLIDE_PURPOSES),
  title: z.string().trim().min(1).max(48),
  subtitle: z.string().trim().max(100),
  items: z.array(contentItemSchema).max(6),
  left: columnSchema.nullable(),
  right: columnSchema.nullable(),
  steps: z.array(contentItemSchema).max(5),
  metric: metricSchema.nullable(),
  chart: chartSchema.nullable(),
  sourceRefs: z.array(z.string().trim().min(1).max(40)).max(6),
  audienceMove: z.string().trim().min(1).max(120)
    .default("帮助受众理解并接受本页结论"),
  visual: commercialVisualIntentV2Schema,
}).strict().superRefine((slide, context) => {
  const visibleContent = [
    slide.title,
    slide.subtitle,
    ...slide.items.flatMap((item) => [item.heading, item.detail]),
    ...(slide.left ? [slide.left.label, ...slide.left.items] : []),
    ...(slide.right ? [slide.right.label, ...slide.right.items] : []),
    ...slide.steps.flatMap((step) => [step.heading, step.detail]),
    ...(slide.metric
      ? [slide.metric.value, slide.metric.label, slide.metric.takeaway]
      : []),
    ...(slide.chart
      ? [
          slide.chart.takeaway,
          slide.chart.unit,
          ...slide.chart.items.flatMap((item) => [
            item.label,
            String(item.value),
          ]),
        ]
      : []),
  ].filter(Boolean);

  for (const [index, emphasis] of slide.visual.emphasis.entries()) {
    if (!visibleContent.some((content) => content.includes(emphasis))) {
      context.addIssue({
        code: "custom",
        path: ["visual", "emphasis", index],
        message: `Emphasis '${emphasis}' must be copied from visible slide content.`,
      });
    }
  }

  const allowedPurposeByKind: Record<typeof slide.kind, readonly string[]> = {
    cover: ["opening"],
    agenda: ["navigation"],
    section: ["navigation"],
    bullets: ["context", "problem", "insight", "solution", "proof", "plan", "ask"],
    comparison: ["context", "problem", "insight", "solution", "proof", "plan", "ask"],
    process: ["solution", "plan"],
    metric: ["proof", "insight"],
    chart: ["proof", "insight"],
    closing: ["close"],
  };
  if (!allowedPurposeByKind[slide.kind].includes(slide.purpose)) {
    context.addIssue({
      code: "custom",
      path: ["purpose"],
      message: `${slide.kind} slide cannot use purpose '${slide.purpose}'.`,
    });
  }

  if (slide.kind === "cover" && !slide.subtitle) {
    context.addIssue({ code: "custom", path: ["subtitle"], message: "Cover requires a subtitle." });
  }
  if (slide.kind === "agenda" && (slide.items.length < 3 || slide.items.length > 6)) {
    context.addIssue({ code: "custom", path: ["items"], message: "Agenda requires 3 to 6 items." });
  }
  if (slide.kind === "bullets" && (slide.items.length < 2 || slide.items.length > 4)) {
    context.addIssue({ code: "custom", path: ["items"], message: "Bullets requires 2 to 4 items." });
  }
  if (slide.kind === "comparison" && (!slide.left || !slide.right)) {
    context.addIssue({ code: "custom", path: ["left"], message: "Comparison requires both columns." });
  }
  if (slide.kind === "process" && (slide.steps.length < 2 || slide.steps.length > 5)) {
    context.addIssue({ code: "custom", path: ["steps"], message: "Process requires 2 to 5 steps." });
  }
  if (slide.kind === "metric" && !slide.metric) {
    context.addIssue({ code: "custom", path: ["metric"], message: "Metric content is required." });
  }
  if (slide.kind === "chart" && !slide.chart) {
    context.addIssue({ code: "custom", path: ["chart"], message: "Chart content is required." });
  }
  if ((slide.kind === "metric" || slide.kind === "chart") && slide.sourceRefs.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["sourceRefs"],
      message: "Metric and chart slides require a visible source.",
    });
  }
  if (slide.kind === "closing" && (!slide.subtitle || slide.items.length < 1 || slide.items.length > 3)) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "Closing requires a takeaway and 1 to 3 actions.",
    });
  }
});

const sourceSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  asOf: z.string().trim().max(30).nullable(),
  provenance: z.enum(["user", "illustrative"]),
}).strict();

export const leanDeckSpecV2Schema = z.object({
  version: z.literal(2),
  title: z.string().trim().min(1).max(80),
  locale: z.enum(["zh-CN", "en-US"]),
  scenario: z.enum(LEAN_DECK_SCENARIOS),
  audience: commercialCommunicationSchema.shape.audience,
  objective: commercialCommunicationSchema.shape.objective,
  desiredAction: commercialCommunicationSchema.shape.desiredAction,
  coreMessage: commercialCommunicationSchema.shape.coreMessage
    .default(COMMERCIAL_COMMUNICATION_DEFAULTS.coreMessage),
  presentationContext: commercialCommunicationSchema.shape.presentationContext
    .default(COMMERCIAL_COMMUNICATION_DEFAULTS.presentationContext),
  afterUse: commercialCommunicationSchema.shape.afterUse
    .default(COMMERCIAL_COMMUNICATION_DEFAULTS.afterUse),
  restructurePermission: restructurePermissionSchema
    .default(COMMERCIAL_COMMUNICATION_DEFAULTS.restructurePermission),
  narrativeMode: narrativeModeSchema
    .default(COMMERCIAL_COMMUNICATION_DEFAULTS.narrativeMode),
  durationMinutes: z.number().int().min(5).max(30),
  designPreset: z.enum(["business", "report", "technical"]),
  sources: z.array(sourceSchema).max(12),
  slides: z.array(leanSlideSpecV2Schema).min(6).max(12),
}).strict().superRefine((deck, context) => {
  const v1Compatibility = leanDeckSpecSchema.safeParse({
    version: 1,
    title: deck.title,
    locale: deck.locale,
    scenario: deck.scenario,
    audience: deck.audience,
    objective: deck.objective,
    desiredAction: deck.desiredAction,
    durationMinutes: deck.durationMinutes,
    designPreset: deck.designPreset,
    sources: deck.sources,
    slides: deck.slides.map(({ visual: _visual, audienceMove: _audienceMove, ...slide }) => slide),
  });
  if (!v1Compatibility.success) {
    for (const issue of v1Compatibility.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  }

  const sourceIds = new Set<string>();
  deck.sources.forEach((source, index) => {
    if (sourceIds.has(source.id)) {
      context.addIssue({ code: "custom", path: ["sources", index, "id"], message: "Duplicate source id." });
    }
    sourceIds.add(source.id);
  });
  if (deck.slides[0]?.kind !== "cover") {
    context.addIssue({ code: "custom", path: ["slides", 0, "kind"], message: "First slide must be cover." });
  }
  if (deck.slides.at(-1)?.kind !== "closing") {
    context.addIssue({ code: "custom", path: ["slides", deck.slides.length - 1, "kind"], message: "Last slide must be closing." });
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
  });
});

export type CommercialVisualIntentV2 = z.infer<typeof commercialVisualIntentV2Schema>;
export type LeanSlideSpecV2 = z.infer<typeof leanSlideSpecV2Schema>;
export type LeanDeckSpecV2 = z.infer<typeof leanDeckSpecV2Schema>;

export function migrateLeanDeckSpecV1ToV2(input: LeanDeckSpec): LeanDeckSpecV2 {
  const spec = leanDeckSpecSchema.parse(input);
  return leanDeckSpecV2Schema.parse({
    ...spec,
    version: 2,
    slides: spec.slides.map((slide) => {
      const visual: CommercialVisualIntentV2 = slide.kind === "cover"
        ? {
            role: "hero",
            composition: "minimal-statement",
            imageMode: "none",
            assetBrief: "",
            emphasis: [slide.title],
          }
        : slide.kind === "agenda"
          ? {
              role: "overview",
              composition: "editorial-grid",
              imageMode: "none",
              assetBrief: "",
              emphasis: [slide.title],
            }
          : slide.kind === "comparison"
            ? {
                role: "comparison",
                composition: "split",
                imageMode: "none",
                assetBrief: "",
                emphasis: [slide.title],
              }
            : slide.kind === "process"
              ? {
                  role: "process",
                  composition: "editorial-grid",
                  imageMode: "none",
                  assetBrief: "",
                  emphasis: [slide.title],
                }
              : slide.kind === "metric" || slide.kind === "chart"
                ? {
                    role: "evidence",
                    composition: "metric-story",
                    imageMode: "none",
                    assetBrief: "",
                    emphasis: [
                      slide.metric?.value
                      ?? slide.chart?.takeaway
                      ?? slide.title,
                    ],
                  }
                : slide.kind === "closing" || slide.kind === "section"
                  ? {
                      role: "statement",
                      composition: "minimal-statement",
                      imageMode: "none",
                      assetBrief: "",
                      emphasis: [slide.title],
                    }
                  : {
                      role: slide.purpose === "proof" ? "evidence" : "statement",
                      composition: "editorial-grid",
                      imageMode: "none",
                      assetBrief: "",
                      emphasis: [slide.title],
                    };
      const audienceMove = slide.purpose === "opening"
        ? "建立共同语境并明确整套演示的核心承诺"
        : slide.purpose === "navigation"
          ? "让受众理解接下来的决策路径"
          : slide.purpose === "problem"
            ? "让受众承认问题及其业务影响"
            : slide.purpose === "proof" || slide.purpose === "insight"
              ? "让受众相信核心判断有证据支撑"
              : slide.purpose === "solution" || slide.purpose === "plan"
                ? "让受众理解方案并判断其可执行性"
                : slide.purpose === "ask" || slide.purpose === "close"
                  ? "推动受众确认决定与下一步行动"
                  : "帮助受众理解并接受本页结论";
      return { ...slide, audienceMove, visual };
    }),
  });
}
