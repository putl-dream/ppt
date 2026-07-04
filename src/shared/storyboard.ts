import { z } from "zod";

import { SLIDE_LAYOUTS } from "./slide-layouts";

export const slideLayoutSchema = z.enum(SLIDE_LAYOUTS);

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
  suggestedLayout: slideLayoutSchema.optional(),
  layout: slideLayoutSchema.optional(),
  quote: z.string().optional(),
  status: storyboardSlideStatusSchema.default("pending"),
});

export type SlideLayout = z.infer<typeof slideLayoutSchema>;
export type StoryboardSlideStatus = z.infer<typeof storyboardSlideStatusSchema>;
export type StoryboardSlideSpec = z.infer<typeof storyboardSlideSpecSchema>;

const legacyStoryboardItemSchema = z.object({
  title: z.string(),
  layout: z.string().optional(),
  keyPoints: z.array(z.string()).default([]),
  quote: z.string().optional(),
  id: z.string().optional(),
  suggestedLayout: slideLayoutSchema.optional(),
  status: storyboardSlideStatusSchema.optional(),
});

export function normalizeStoryboardSlide(raw: unknown, index: number): StoryboardSlideSpec {
  const parsed = legacyStoryboardItemSchema.parse(raw);
  const layout = (parsed.suggestedLayout ?? parsed.layout) as SlideLayout | undefined;

  return storyboardSlideSpecSchema.parse({
    id: parsed.id ?? `storyboard-slide-${index + 1}`,
    title: parsed.title,
    keyPoints: parsed.keyPoints,
    suggestedLayout: layout,
    layout,
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
  return storyboardSlideSpecSchema.parse({
    id: `storyboard-slide-${index + 1}`,
    title,
    keyPoints: [title],
    suggestedLayout: index === 0 ? "cover" : "concept",
    layout: index === 0 ? "cover" : "concept",
    quote: "",
    status: "pending",
  });
}
