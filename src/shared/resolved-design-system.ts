import type { Slide } from "./presentation";
import {
  DESIGN_TOKEN_COLOR_SPECS,
  isDarkDesignTokens,
  resolveDesignTokenColors,
  resolveDesignTokenFontFamily,
  resolveDesignTokens,
  type ChartStyle,
  type Density,
  type DesignTokenColors,
  type DesignTokensV1,
  type ImageTreatment,
} from "./design-tokens";
import { getThemePaletteColors } from "./layout";
import type { SlideBackgroundStyle } from "./slide-background";
import { resolveSlideBackgroundWithVariant, resolveSlideVariant } from "./slide-variant";
import {
  fontFamilyToCss,
  fontFamilyToPptxFace,
  resolveFontFamily,
  type FontFamily,
} from "./typography";

export interface DesignSystemSource {
  theme?: string;
  palette?: string;
  designTokens?: DesignTokensV1;
}

export interface ResolvedDesignSystem {
  theme: string;
  palette: string;
  hasExplicitDesignTokens: boolean;
  tokens: DesignTokensV1;
  colors: DesignTokenColors;
  background: SlideBackgroundStyle;
  fontFamily: FontFamily;
  fontCss: string;
  fontFace: string;
  imageTreatment: ImageTreatment;
  chartStyle: ChartStyle;
  density: Density;
}

function legacyColors(theme: string, palette: string): DesignTokenColors {
  const colors = getThemePaletteColors(theme, palette);
  return {
    ...colors,
    muted: colors.cardBg,
    softAccent: colors.cardStroke,
  };
}

function resolveContrastMode(
  slide: Slide,
  tokens: DesignTokensV1,
  hasExplicitDesignTokens: boolean,
  legacy: DesignTokenColors,
): "light" | "dark" {
  const variant = resolveSlideVariant(slide);
  if (variant === "light") return "light";
  if (variant === "dark") return "dark";
  if (hasExplicitDesignTokens) return isDarkDesignTokens(tokens) ? "dark" : "light";
  return legacy.title.toLowerCase() === "#f8fafc" ? "dark" : "light";
}

function adaptLegacyColors(
  colors: DesignTokenColors,
  mode: "light" | "dark",
  slide: Slide,
): DesignTokenColors {
  if (!slide.slideVariant) return colors;
  const isAlreadyDark = colors.title.toLowerCase() === "#f8fafc";
  if ((mode === "dark") === isAlreadyDark) return colors;
  const base = mode === "dark"
    ? DESIGN_TOKEN_COLOR_SPECS["tech-dark"]
    : DESIGN_TOKEN_COLOR_SPECS["business-blue"];
  return { ...base, accent: colors.accent };
}

function tokenBackground(
  tokens: DesignTokensV1,
  colors: DesignTokenColors,
  mode: "light" | "dark",
): SlideBackgroundStyle {
  if (mode === "dark") {
    return { slideBg: colors.bg, exportFill: colors.bg };
  }

  if (tokens.backgroundStyle === "gradient") {
    return {
      slideBg: `linear-gradient(135deg, ${colors.bg} 0%, ${colors.softAccent} 100%)`,
      exportFill: colors.bg,
      gradient: {
        type: "linear",
        angle: 135,
        stops: [
          { color: colors.bg, pos: 0 },
          { color: colors.softAccent, pos: 100 },
        ],
      },
    };
  }

  if (tokens.backgroundStyle === "paper") {
    return {
      slideBg: `linear-gradient(180deg, ${colors.bg} 0%, ${colors.muted} 100%)`,
      exportFill: colors.bg,
      gradient: {
        type: "linear",
        angle: 180,
        stops: [
          { color: colors.bg, pos: 0 },
          { color: colors.muted, pos: 100 },
        ],
      },
    };
  }

  if (tokens.backgroundStyle === "grid") {
    const size = 32;
    return {
      slideBg: `${
        `linear-gradient(${colors.cardStroke} 1px, transparent 1px) 0 0 / ${size}px ${size}px, ` +
        `linear-gradient(90deg, ${colors.cardStroke} 1px, transparent 1px) 0 0 / ${size}px ${size}px, `
      }${colors.bg}`,
      exportFill: colors.bg,
      pattern: { type: "grid", color: colors.cardStroke, size },
    };
  }

  return { slideBg: colors.bg, exportFill: colors.bg };
}

/** The single visual contract consumed by editor, thumbnail and PPTX renderers. */
export function resolveSlideDesignSystem(
  source: DesignSystemSource,
  slide: Slide,
): ResolvedDesignSystem {
  const theme = source.theme ?? "nordic";
  const palette = source.palette ?? "cyan";
  const explicitTokens = slide.designTokens ?? source.designTokens;
  const hasExplicitDesignTokens = Boolean(explicitTokens);
  const tokens = resolveDesignTokens(explicitTokens);
  const legacy = legacyColors(theme, palette);
  const mode = resolveContrastMode(slide, tokens, hasExplicitDesignTokens, legacy);
  const colors = hasExplicitDesignTokens
    ? resolveDesignTokenColors(tokens, legacy, mode)
    : adaptLegacyColors(legacy, mode, slide);
  const legacyFont = resolveFontFamily(undefined, undefined, theme);
  const fontFamily = hasExplicitDesignTokens
    ? resolveDesignTokenFontFamily(tokens, legacyFont)
    : legacyFont;
  const background = hasExplicitDesignTokens
    ? tokenBackground(tokens, colors, mode)
    : resolveSlideBackgroundWithVariant(theme, palette, slide);

  return {
    theme,
    palette,
    hasExplicitDesignTokens,
    tokens,
    colors,
    background,
    fontFamily,
    fontCss: fontFamilyToCss(fontFamily),
    fontFace: fontFamilyToPptxFace(fontFamily),
    imageTreatment: tokens.imageTreatment,
    chartStyle: tokens.chartStyle,
    density: tokens.density,
  };
}
