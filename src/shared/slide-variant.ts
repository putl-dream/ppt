
/** Per-slide visual rhythm (guizang light/dark/hero). Resolved with deck design tokens. */
export const SLIDE_VARIANTS = ["light", "dark", "hero"] as const;
export type SlideVariant = (typeof SLIDE_VARIANTS)[number];

/** Resolve explicit slide variant, falling back to layout-inferred rhythm. */
export function resolveSlideVariant(
  slide: { slideVariant?: SlideVariant; layout?: string },
): SlideVariant | undefined {
  if (slide.slideVariant) return slide.slideVariant;
  const layout = slide.layout;
  if (layout === "cover" || layout === "section") return "hero";
  if (layout === "quote") return "light";
  return undefined;
}

