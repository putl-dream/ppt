export const BACKGROUND_VARIANTS = ["default", "hero", "muted"] as const;
export type BackgroundVariant = (typeof BACKGROUND_VARIANTS)[number];

export interface GradientStop {
  color: string;
  pos: number;
}

export interface BackgroundGradient {
  type: "linear" | "radial";
  angle?: number;
  stops: GradientStop[];
}

export interface SlideBackgroundStyle {
  /** CSS background for canvas / mirror */
  slideBg: string;
  /** Solid fill for PPTX export fallback */
  exportFill: string;
  /** Structured gradient for rasterized PPTX export */
  gradient?: BackgroundGradient;
  /** Structured pattern so canvas, HTML and PPTX can render the same surface. */
  pattern?: {
    type: "grid";
    color: string;
    size: number;
  };
}

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

export function resolveSlideBackground(
  theme: string,
  _palette: string,
  variant: BackgroundVariant = "default",
): SlideBackgroundStyle {
  switch (theme) {
    case "nordic":
      if (variant === "hero") {
        return { slideBg: "#fbfbfa", exportFill: "#fbfbfa" };
      }
      if (variant === "muted") {
        return { slideBg: "#f4f4f3", exportFill: "#f4f4f3" };
      }
      return { slideBg: "#ffffff", exportFill: "#ffffff" };
    case "midnight":
      if (variant === "hero") {
        return { slideBg: "#0e1115", exportFill: "#0e1115" };
      }
      if (variant === "muted") {
        return { slideBg: "#12161c", exportFill: "#12161c" };
      }
      return { slideBg: "#161b22", exportFill: "#161b22" };
    case "ocean":
      if (variant === "hero") {
        return {
          slideBg: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          exportFill: "#0f172a",
          gradient: {
            type: "linear",
            angle: 135,
            stops: [
              { color: "#0f172a", pos: 0 },
              { color: "#1e293b", pos: 100 },
            ],
          },
        };
      }
      if (variant === "muted") {
        return { slideBg: "#1e293b", exportFill: "#1e293b" };
      }
      return { slideBg: "#0f172a", exportFill: "#0f172a" };
    case "sunset":
      if (variant === "hero") {
        return {
          slideBg: "linear-gradient(135deg, #fffcf4 0%, #fff3e3 100%)",
          exportFill: "#fffcf4",
          gradient: {
            type: "linear",
            angle: 135,
            stops: [
              { color: "#fffcf4", pos: 0 },
              { color: "#fff3e3", pos: 100 },
            ],
          },
        };
      }
      if (variant === "muted") {
        return { slideBg: "#fff8eb", exportFill: "#fff8eb" };
      }
      return { slideBg: "#fffcf4", exportFill: "#fffcf4" };
    case "purple":
      if (variant === "hero") {
        return {
          slideBg: "radial-gradient(circle at top, #1c1537 0%, #0d091a 100%)",
          exportFill: "#1c1537",
          gradient: {
            type: "radial",
            stops: [
              { color: "#1c1537", pos: 0 },
              { color: "#0d091a", pos: 100 },
            ],
          },
        };
      }
      if (variant === "muted") {
        return { slideBg: "#2b2050", exportFill: "#2b2050" };
      }
      return { slideBg: "#1c1537", exportFill: "#1c1537" };
    default:
      return { slideBg: "#ffffff", exportFill: "#ffffff" };
  }
}
