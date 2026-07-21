import type { SlideLayoutType } from "./slide-layouts";

export const LAYOUT_GRAMMAR_VARIANTS = {
  cover: ["centered", "editorial-hero", "signal-dark"],
  section: ["centered", "editorial-split", "band"],
  process: ["cards", "timeline", "path", "steps"],
  case: ["split", "metric-focus", "evidence"],
  "image-grid": ["grid", "hero-caption", "filmstrip", "evidence-wall"],
  toc: ["numbered-list", "chapter-rail", "editorial-index"],
  concept: ["cards", "statement-stack", "editorial-columns"],
  comparison: ["split", "before-after", "verdict"],
  quote: ["centered-card", "editorial-pullquote", "quote-band"],
  summary: ["action-list", "three-takeaways", "closing-checklist"],
} as const satisfies Partial<Record<SlideLayoutType, readonly string[]>>;

export function getSupportedGrammarVariants(layout: SlideLayoutType): readonly string[] {
  return LAYOUT_GRAMMAR_VARIANTS[layout as keyof typeof LAYOUT_GRAMMAR_VARIANTS] ?? [];
}
