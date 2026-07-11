import { fontFamilyToCss, fontFamilyToPptxFace, type FontFamily } from "@shared/typography";
import { resolveBackground, type ResolvedBackground } from "./backgrounds";
import { isDarkTokens, resolveColors, type ResolvedColors } from "./colors";
import {
  resolveDesignTokens,
  type ChartStyle,
  type Density,
  type DesignSystemV1,
  type DesignTokens,
  type ImageTreatment,
  type SlideDesignOverride,
} from "./schema";

export interface SlideDesignInput {
  layout?: string;
  slideVariant?: "light" | "dark" | "hero";
  designOverride?: SlideDesignOverride;
}

export interface ResolvedSlideStyle {
  tokens: DesignTokens;
  mode: "light" | "dark";
  colors: ResolvedColors;
  background: ResolvedBackground;
  typography: { family: FontFamily; css: string; pptxFace: string };
  image: { treatment: ImageTreatment };
  chart: { style: ChartStyle };
  density: Density;
}

function resolveMode(tokens: DesignTokens, slide: SlideDesignInput): "light" | "dark" {
  if (slide.slideVariant === "light") return "light";
  if (slide.slideVariant === "dark") return "dark";
  return isDarkTokens(tokens) ? "dark" : "light";
}

function resolveFont(tokens: DesignTokens): FontFamily {
  if (tokens.fontMood === "technical") return "mono";
  if (tokens.fontMood === "formal" || tokens.fontMood === "editorial") return "serif";
  return "sans";
}

export function resolveSlideStyle(
  system: DesignSystemV1,
  slide: SlideDesignInput,
): ResolvedSlideStyle {
  const tokens = resolveDesignTokens(system, slide.designOverride);
  const mode = resolveMode(tokens, slide);
  const colors = resolveColors(tokens, mode);
  const family = resolveFont(tokens);
  return {
    tokens,
    mode,
    colors,
    background: resolveBackground(tokens, colors, mode),
    typography: { family, css: fontFamilyToCss(family), pptxFace: fontFamilyToPptxFace(family) },
    image: { treatment: tokens.imageTreatment },
    chart: { style: tokens.chartStyle },
    density: tokens.density,
  };
}
