import type { DesignTokens } from "./schema";
import type { ResolvedColors } from "./colors";

export interface GradientStop { color: string; pos: number }
export interface BackgroundGradient {
  type: "linear" | "radial";
  angle?: number;
  stops: GradientStop[];
}
export interface ResolvedBackground {
  css: string;
  fill: string;
  gradient?: BackgroundGradient;
  pattern?: { type: "grid"; color: string; size: number };
}

export function resolveBackground(
  tokens: DesignTokens,
  colors: ResolvedColors,
  mode: "light" | "dark",
): ResolvedBackground {
  if (mode === "dark") return { css: colors.bg, fill: colors.bg };
  if (tokens.backgroundStyle === "gradient") {
    return {
      css: `linear-gradient(135deg, ${colors.bg} 0%, ${colors.softAccent} 100%)`,
      fill: colors.bg,
      gradient: { type: "linear", angle: 135, stops: [{ color: colors.bg, pos: 0 }, { color: colors.softAccent, pos: 100 }] },
    };
  }
  if (tokens.backgroundStyle === "paper") {
    return {
      css: `linear-gradient(180deg, ${colors.bg} 0%, ${colors.muted} 100%)`,
      fill: colors.bg,
      gradient: { type: "linear", angle: 180, stops: [{ color: colors.bg, pos: 0 }, { color: colors.muted, pos: 100 }] },
    };
  }
  if (tokens.backgroundStyle === "grid") {
    const size = 32;
    return {
      css: `linear-gradient(${colors.cardStroke} 1px, transparent 1px) 0 0 / ${size}px ${size}px, linear-gradient(90deg, ${colors.cardStroke} 1px, transparent 1px) 0 0 / ${size}px ${size}px, ${colors.bg}`,
      fill: colors.bg,
      pattern: { type: "grid", color: colors.cardStroke, size },
    };
  }
  return { css: colors.bg, fill: colors.bg };
}
