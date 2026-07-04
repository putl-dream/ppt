import type { BackgroundVariant } from "./slide-background";
import {
  resolveLayoutBackgroundVariant,
  resolveSlideBackground,
  resolveSlideBackgroundVariant,
  type SlideBackgroundStyle,
} from "./slide-background";

/** Per-slide visual rhythm (guizang light/dark/hero). Overrides theme-level defaults. */
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

/** Map slide variant + background variant to effective background key. */
export function resolveEffectiveBackgroundVariant(
  slide: {
    slideVariant?: SlideVariant;
    backgroundVariant?: BackgroundVariant;
    layout?: string;
  },
): BackgroundVariant {
  const variant = resolveSlideVariant(slide);
  if (variant === "hero") return "hero";
  if (variant === "dark") return "muted";
  if (variant === "light") return "default";
  return resolveSlideBackgroundVariant(slide);
}

function resolveHeroAccent(
  theme: string,
  _palette: string,
): { from: string; to: string } {
  switch (theme) {
    case "midnight":
      return { from: "#0e1115", to: "#1a2332" };
    case "ocean":
      return { from: "#0f172a", to: "#1e293b" };
    case "sunset":
      return { from: "#fffcf4", to: "#fff3e3" };
    case "purple":
      return { from: "#1c1537", to: "#2b2050" };
    default:
      return { from: "#fbfbfa", to: "#f0f0ef" };
  }
}

/** Resolve slide background, honoring per-slide variant over deck theme. */
export function resolveSlideBackgroundWithVariant(
  theme: string,
  palette: string,
  slide: {
    slideVariant?: SlideVariant;
    backgroundVariant?: BackgroundVariant;
    layout?: string;
  },
): SlideBackgroundStyle {
  const slideVariant = resolveSlideVariant(slide);

  if (slideVariant === "light") {
    return { slideBg: "#ffffff", exportFill: "#ffffff" };
  }
  if (slideVariant === "dark") {
    return { slideBg: "#0f172a", exportFill: "#0f172a" };
  }

  const bgVariant = resolveEffectiveBackgroundVariant(slide);
  const base = resolveSlideBackground(theme, palette, bgVariant);

  if (slideVariant === "hero" && !base.slideBg.includes("gradient")) {
    const accent = resolveHeroAccent(theme, palette);
    return {
      slideBg: `linear-gradient(135deg, ${accent.from} 0%, ${accent.to} 100%)`,
      exportFill: accent.from,
    };
  }

  return base;
}

export { resolveLayoutBackgroundVariant };
