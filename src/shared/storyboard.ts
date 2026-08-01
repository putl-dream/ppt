import { z } from "zod";

/** 叙事角色：内容规划用的轻量标注（不再绑定 Layout Grammar）。 */
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
  narrativeRole: storyboardNarrativeRoleSchema.optional(),
  quote: z.string().optional(),
  status: storyboardSlideStatusSchema.default("pending"),
});

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
  slideId: z.string().optional(),
  narrativeRole: z.string().optional(),
  suggestedLayout: z.string().optional(),
  status: storyboardSlideStatusSchema.optional(),
});

function normalizeStoryboardNarrativeRole(
  role: string | undefined,
): StoryboardNarrativeRole | undefined {
  if (!role) return undefined;
  const normalized = role.trim().toLowerCase();
  const aliases: Record<string, StoryboardNarrativeRole> = {
    opening: "hook",
    cover: "hook",
    intro: "hook",
    agenda: "section",
    toc: "section",
    transition: "section",
    context: "core",
    content: "core",
    data: "evidence",
    proof: "evidence",
    comparison: "compare",
    shift: "core",
    takeaway: "summary",
    conclusion: "summary",
    closing: "summary",
  };

  if (storyboardNarrativeRoleSchema.safeParse(normalized).success) {
    return normalized as StoryboardNarrativeRole;
  }
  return aliases[normalized];
}

export function normalizeStoryboardSlide(raw: unknown, index: number): StoryboardSlideSpec {
  const parsed = legacyStoryboardItemSchema.parse(raw);
  const keyPoints = parsed.keyPoints.length > 0
    ? parsed.keyPoints
    : (parsed.bulletPoints ?? []);
  const narrativeRole = normalizeStoryboardNarrativeRole(parsed.narrativeRole);

  return storyboardSlideSpecSchema.parse({
    id: parsed.id ?? parsed.slideId ?? `storyboard-slide-${index + 1}`,
    title: parsed.title,
    keyPoints,
    narrativeRole,
    quote: parsed.quote ?? "",
    status: parsed.status ?? "pending",
  });
}

export function parseStoryboard(content: string): StoryboardSlideSpec[] {
  const raw = JSON.parse(content);
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { slides?: unknown }).slides)
      ? (raw as { slides: unknown[] }).slides
      : null;
  if (!items) {
    throw new Error("Storyboard must be a JSON array or an object with a slides array.");
  }
  return items.map((item, index) => normalizeStoryboardSlide(item, index));
}

export function serializeStoryboard(slides: StoryboardSlideSpec[]): string {
  const normalized = slides.map((slide, index) =>
    storyboardSlideSpecSchema.parse({
      ...slide,
      id: slide.id || `storyboard-slide-${index + 1}`,
    }),
  );
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function createDefaultStoryboardSlide(title: string, index = 0): StoryboardSlideSpec {
  const narrativeRole = index === 0 ? "hook" : "core";
  return storyboardSlideSpecSchema.parse({
    id: `storyboard-slide-${index + 1}`,
    title,
    keyPoints: [title],
    narrativeRole,
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
    return title.length > 0
      && slide.keyPoints.length === 1
      && slide.keyPoints[0].trim() === title
      && (slide.narrativeRole ?? "hook") === "hook"
      && !(slide.quote ?? "").trim()
      && (slide.status ?? "pending") === "pending";
  } catch {
    return false;
  }
}
