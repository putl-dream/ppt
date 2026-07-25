import type { VisualStyleDefinition } from "./catalog";
import type { ResolvedColors } from "./colors";
import type { DesignTokens } from "./schema";

export interface GradientStop { color: string; pos: number }
export interface BackgroundGradient {
  type: "linear" | "radial";
  angle?: number;
  stops: GradientStop[];
}

export interface BackgroundPattern {
  type: "grid" | "dots" | "halftone" | "pixel";
  color: string;
  size: number;
  opacity?: number;
}

export interface ResolvedBackground {
  css: string;
  fill: string;
  gradient?: BackgroundGradient;
  pattern?: BackgroundPattern;
  texture: {
    kind: VisualStyleDefinition["texture"]["kind"];
    opacity: number;
    css?: string;
  };
}

function rgba(hex: string, opacity: number): string {
  const values = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${opacity})`;
}

function resolvePattern(
  requested: VisualStyleDefinition["background"]["pattern"] | undefined,
  colors: ResolvedColors,
): { css: string; pattern?: BackgroundPattern } {
  switch (requested) {
    case "grid": {
      const size = 32;
      return {
        css: `linear-gradient(${colors.grid} 1px, transparent 1px) 0 0 / ${size}px ${size}px, linear-gradient(90deg, ${colors.grid} 1px, transparent 1px) 0 0 / ${size}px ${size}px`,
        pattern: { type: "grid", color: colors.grid, size, opacity: 0.45 },
      };
    }
    case "dots": {
      const size = 24;
      return {
        css: `radial-gradient(circle, ${colors.grid} 1.5px, transparent 1.5px) 0 0 / ${size}px ${size}px`,
        pattern: { type: "dots", color: colors.grid, size, opacity: 0.35 },
      };
    }
    case "halftone": {
      const size = 12;
      return {
        css: `radial-gradient(circle, ${colors.grid} 1px, transparent 1.25px) 0 0 / ${size}px ${size}px`,
        pattern: { type: "halftone", color: colors.grid, size, opacity: 0.3 },
      };
    }
    case "pixel": {
      const size = 16;
      return {
        css: `linear-gradient(${colors.grid} 1px, transparent 1px) 0 0 / ${size}px ${size}px, linear-gradient(90deg, ${colors.grid} 1px, transparent 1px) 0 0 / ${size}px ${size}px`,
        pattern: { type: "pixel", color: colors.grid, size, opacity: 0.38 },
      };
    }
    default:
      return { css: "" };
  }
}

function resolveTexture(
  texture: VisualStyleDefinition["texture"] | undefined,
  colors: ResolvedColors,
): string {
  if (!texture || texture.kind === "none" || texture.opacity <= 0) return "";
  const ink = rgba(colors.grid, texture.opacity);
  const accent = rgba(colors.accent, texture.opacity);
  switch (texture.kind) {
    case "paper-grain":
      return `repeating-radial-gradient(circle at 20% 30%, ${ink} 0 0.6px, transparent 0.8px 5px)`;
    case "halftone":
      return `radial-gradient(circle, ${ink} 1px, transparent 1.3px) 0 0 / 12px 12px`;
    case "frosted-glass":
      return `radial-gradient(circle at 22% 18%, ${accent} 0%, transparent 34%)`;
    case "fine-grid":
      return `linear-gradient(${ink} 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0 / 32px 32px`;
    case "chalk-dust":
      return `repeating-radial-gradient(circle at 35% 45%, ${ink} 0 0.8px, transparent 1px 9px)`;
    case "ink-bleed":
      return `radial-gradient(ellipse at 18% 82%, ${ink} 0%, transparent 42%)`;
    case "misregistration":
      return `radial-gradient(circle, ${accent} 1px, transparent 1.4px) 2px 1px / 14px 14px, radial-gradient(circle, ${ink} 1px, transparent 1.4px) 0 0 / 14px 14px`;
    case "pixel-grid":
      return `linear-gradient(${ink} 1px, transparent 1px) 0 0 / 16px 16px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0 / 16px 16px`;
  }
}

function resolveBase(
  tokens: DesignTokens,
  colors: ResolvedColors,
  behavior?: VisualStyleDefinition["background"],
): Pick<ResolvedBackground, "css" | "fill" | "gradient"> {
  const gradientBehavior = behavior?.gradient ?? (
    tokens.backgroundStyle === "gradient" ? "subtle" : "none"
  );
  if (gradientBehavior === "luminous") {
    return {
      css: `radial-gradient(circle at 72% 28%, ${colors.secondaryAccent} 0%, ${colors.background} 58%, ${colors.scrim} 100%)`,
      fill: colors.background,
      gradient: {
        type: "radial",
        stops: [
          { color: colors.secondaryAccent, pos: 0 },
          { color: colors.background, pos: 58 },
          { color: colors.scrim, pos: 100 },
        ],
      },
    };
  }
  if (gradientBehavior === "subtle" || tokens.backgroundStyle === "gradient") {
    return {
      css: `linear-gradient(135deg, ${colors.background} 0%, ${colors.secondaryBg} 100%)`,
      fill: colors.background,
      gradient: {
        type: "linear",
        angle: 135,
        stops: [
          { color: colors.background, pos: 0 },
          { color: colors.secondaryBg, pos: 100 },
        ],
      },
    };
  }
  if (tokens.backgroundStyle === "paper") {
    return {
      css: `linear-gradient(180deg, ${colors.background} 0%, ${colors.secondaryBg} 100%)`,
      fill: colors.background,
      gradient: {
        type: "linear",
        angle: 180,
        stops: [
          { color: colors.background, pos: 0 },
          { color: colors.secondaryBg, pos: 100 },
        ],
      },
    };
  }
  return { css: colors.background, fill: colors.background };
}

export function resolveBackground(
  tokens: DesignTokens,
  colors: ResolvedColors,
  _mode: "light" | "dark",
  style?: VisualStyleDefinition,
): ResolvedBackground {
  const behavior = style && style.background.style === tokens.backgroundStyle
    ? style.background
    : undefined;
  const base = resolveBase(tokens, colors, behavior);
  const requestedPattern = tokens.backgroundStyle === "grid"
    ? "grid"
    : behavior?.pattern ?? "none";
  const resolvedPattern = resolvePattern(requestedPattern, colors);
  const textureCss = resolveTexture(style?.texture, colors);
  const layers = [resolvedPattern.css, textureCss, base.css].filter(Boolean);
  return {
    ...base,
    css: layers.join(", "),
    pattern: resolvedPattern.pattern,
    texture: {
      ...(style?.texture ?? { kind: "none" as const, opacity: 0 }),
      ...(textureCss ? { css: textureCss } : {}),
    },
  };
}
