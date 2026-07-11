export const BACKGROUND_VARIANTS = ["default", "hero", "muted"] as const;
export type BackgroundVariant = (typeof BACKGROUND_VARIANTS)[number];

/** Infer background variant from layout when slide has no explicit variant. */
export function resolveLayoutBackgroundVariant(layout: string | undefined): BackgroundVariant {
  if (layout === "cover" || layout === "section") return "hero";
  if (layout === "quote") return "muted";
  return "default";
}

export function resolveSlideBackgroundVariant(
  slide: { layout?: string; backgroundVariant?: BackgroundVariant },
): BackgroundVariant {
  return slide.backgroundVariant ?? resolveLayoutBackgroundVariant(slide.layout);
}

