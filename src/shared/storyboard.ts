import { z } from "zod";

import { SLIDE_LAYOUTS } from "./slide-layouts";

export const slideLayoutSchema = z.enum(SLIDE_LAYOUTS);

/** 叙事角色：内容与版式联合决策的轻量标注（P1-2）。 */
export const storyboardNarrativeRoleSchema = z.enum([
  "hook",
  "section",
  "core",
  "evidence",
  "process",
  "compare",
  "summary",
]);

export const storyboardSlideStatusSchema = z.enum([
  "pending",
  "generating",
  "done",
  "failed",
]);

export const storyboardSlideSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  keyPoints: z.array(z.string()),
  /** 叙事角色，驱动 layout 预选与排版阶段节奏。 */
  narrativeRole: storyboardNarrativeRoleSchema.optional(),
  suggestedLayout: slideLayoutSchema.optional(),
  layout: slideLayoutSchema.optional(),
  quote: z.string().optional(),
  status: storyboardSlideStatusSchema.default("pending"),
});

export type SlideLayout = z.infer<typeof slideLayoutSchema>;
export type StoryboardNarrativeRole = z.infer<typeof storyboardNarrativeRoleSchema>;
export type StoryboardSlideStatus = z.infer<typeof storyboardSlideStatusSchema>;
export type StoryboardSlideSpec = z.infer<typeof storyboardSlideSpecSchema>;

const legacyStoryboardItemSchema = z.object({
  title: z.string(),
  layout: z.string().optional(),
  keyPoints: z.array(z.string()).default([]),
  bulletPoints: z.array(z.string()).optional(),
  quote: z.string().optional(),
  id: z.string().optional(),
  narrativeRole: storyboardNarrativeRoleSchema.optional(),
  suggestedLayout: slideLayoutSchema.optional(),
  status: storyboardSlideStatusSchema.optional(),
});

/** narrativeRole → 推荐 layout（可被 suggestedLayout 覆盖）。 */
export const NARRATIVE_ROLE_DEFAULT_LAYOUT: Record<
  z.infer<typeof storyboardNarrativeRoleSchema>,
  SlideLayout
> = {
  hook: "cover",
  section: "section",
  core: "concept",
  evidence: "case",
  process: "process",
  compare: "comparison",
  summary: "summary",
};

export function resolveStoryboardLayout(
  slide: Pick<StoryboardSlideSpec, "narrativeRole" | "suggestedLayout" | "layout">,
): SlideLayout | undefined {
  return slide.layout ?? slide.suggestedLayout
    ?? (slide.narrativeRole ? NARRATIVE_ROLE_DEFAULT_LAYOUT[slide.narrativeRole] : undefined);
}

export function normalizeStoryboardSlide(raw: unknown, index: number): StoryboardSlideSpec {
  const parsed = legacyStoryboardItemSchema.parse(raw);
  const keyPoints = parsed.keyPoints.length > 0
    ? parsed.keyPoints
    : (parsed.bulletPoints ?? []);
  const layout = (parsed.suggestedLayout ?? parsed.layout) as SlideLayout | undefined;
  const narrativeRole = parsed.narrativeRole;

  return storyboardSlideSpecSchema.parse({
    id: parsed.id ?? `storyboard-slide-${index + 1}`,
    title: parsed.title,
    keyPoints,
    narrativeRole,
    suggestedLayout: layout ?? (narrativeRole ? NARRATIVE_ROLE_DEFAULT_LAYOUT[narrativeRole] : undefined),
    layout: layout ?? (narrativeRole ? NARRATIVE_ROLE_DEFAULT_LAYOUT[narrativeRole] : undefined),
    quote: parsed.quote ?? "",
    status: parsed.status ?? "pending",
  });
}

export function parseStoryboard(content: string): StoryboardSlideSpec[] {
  const raw = JSON.parse(content);
  if (!Array.isArray(raw)) {
    throw new Error("Storyboard must be a JSON array.");
  }
  return raw.map((item, index) => normalizeStoryboardSlide(item, index));
}

export function serializeStoryboard(slides: StoryboardSlideSpec[]): string {
  const normalized = slides.map((slide, index) =>
    storyboardSlideSpecSchema.parse({
      ...slide,
      id: slide.id || `storyboard-slide-${index + 1}`,
      suggestedLayout: slide.suggestedLayout ?? slide.layout,
      layout: slide.layout ?? slide.suggestedLayout,
    }),
  );
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function createDefaultStoryboardSlide(title: string, index = 0): StoryboardSlideSpec {
  const narrativeRole = index === 0 ? "hook" : "core";
  const layout = NARRATIVE_ROLE_DEFAULT_LAYOUT[narrativeRole];
  return storyboardSlideSpecSchema.parse({
    id: `storyboard-slide-${index + 1}`,
    title,
    keyPoints: [title],
    narrativeRole,
    suggestedLayout: layout,
    layout,
    quote: "",
    status: "pending",
  });
}

export function isDefaultStoryboardContent(content: string): boolean {
  try {
    const slides = parseStoryboard(content);
    if (slides.length !== 1) return false;

    const slide = slides[0];
    const title = slide.title.trim();
    const layout = slide.layout ?? slide.suggestedLayout;
    return title.length > 0
      && slide.keyPoints.length === 1
      && slide.keyPoints[0].trim() === title
      && (slide.narrativeRole ?? "hook") === "hook"
      && layout === "cover"
      && !(slide.quote ?? "").trim()
      && (slide.status ?? "pending") === "pending";
  } catch {
    return false;
  }
}
