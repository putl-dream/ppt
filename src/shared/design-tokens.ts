import { z } from "zod";
import type { BackgroundVariant } from "./slide-background";

export const DESIGN_TOKEN_PALETTES = [
  "business-blue",
  "warm-paper",
  "mono-report",
  "tech-dark",
  "soft-academic",
] as const;

export const FONT_MOODS = [
  "formal",
  "editorial",
  "technical",
  "warm",
  "minimal",
] as const;

export const SHAPE_LANGUAGES = [
  "cards",
  "annotation",
  "geometric",
  "path",
  "editorial",
] as const;

export const BACKGROUND_STYLES = [
  "clean",
  "paper",
  "grid",
  "gradient",
  "dark",
] as const;

export const MOTIFS = [
  "none",
  "bookmark",
  "chapter-number",
  "arc",
  "path-line",
  "margin-note",
] as const;

export const DENSITIES = ["calm", "standard", "dense"] as const;

export const IMAGE_TREATMENTS = [
  "plain",
  "framed",
  "masked",
  "captioned",
] as const;

export const CHART_STYLES = [
  "minimal",
  "report",
  "dashboard",
  "editorial",
] as const;

export const designTokensV1Schema = z.object({
  version: z.literal(1).default(1),
  palette: z.enum(DESIGN_TOKEN_PALETTES),
  fontMood: z.enum(FONT_MOODS),
  shapeLanguage: z.enum(SHAPE_LANGUAGES),
  backgroundStyle: z.enum(BACKGROUND_STYLES),
  motif: z.enum(MOTIFS),
  density: z.enum(DENSITIES),
  imageTreatment: z.enum(IMAGE_TREATMENTS),
  chartStyle: z.enum(CHART_STYLES),
});

export type DesignTokensV1 = z.infer<typeof designTokensV1Schema>;
export type DesignTokenPalette = (typeof DESIGN_TOKEN_PALETTES)[number];
export type FontMood = (typeof FONT_MOODS)[number];
export type ShapeLanguage = (typeof SHAPE_LANGUAGES)[number];
export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number];
export type Motif = (typeof MOTIFS)[number];
export type Density = (typeof DENSITIES)[number];
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];
export type ChartStyle = (typeof CHART_STYLES)[number];

export const DEFAULT_DESIGN_TOKENS: DesignTokensV1 = {
  version: 1,
  palette: "business-blue",
  fontMood: "formal",
  shapeLanguage: "cards",
  backgroundStyle: "clean",
  motif: "none",
  density: "standard",
  imageTreatment: "plain",
  chartStyle: "minimal",
};

export interface DesignTokenColors {
  bg: string;
  title: string;
  body: string;
  accent: string;
  cardBg: string;
  cardStroke: string;
  muted: string;
  softAccent: string;
}

export const DESIGN_TOKEN_COLOR_SPECS: Record<DesignTokenPalette, DesignTokenColors> = {
  "business-blue": {
    bg: "#f8fbff",
    title: "#0f172a",
    body: "#405066",
    accent: "#2563eb",
    cardBg: "#ffffff",
    cardStroke: "#dbeafe",
    muted: "#eef5ff",
    softAccent: "#bfdbfe",
  },
  "warm-paper": {
    bg: "#fffaf0",
    title: "#31251b",
    body: "#66594b",
    accent: "#b45309",
    cardBg: "#fff7e6",
    cardStroke: "#ead7b7",
    muted: "#f5ead4",
    softAccent: "#f7d9a8",
  },
  "mono-report": {
    bg: "#fafafa",
    title: "#171717",
    body: "#525252",
    accent: "#404040",
    cardBg: "#ffffff",
    cardStroke: "#d4d4d4",
    muted: "#eeeeee",
    softAccent: "#cfcfcf",
  },
  "tech-dark": {
    bg: "#07111f",
    title: "#eff6ff",
    body: "#bad3ee",
    accent: "#22d3ee",
    cardBg: "#0c1b2d",
    cardStroke: "#164e63",
    muted: "#0f2438",
    softAccent: "#155e75",
  },
  "soft-academic": {
    bg: "#f8fbf7",
    title: "#1f3328",
    body: "#4b6355",
    accent: "#2f7d5b",
    cardBg: "#ffffff",
    cardStroke: "#d7e6da",
    muted: "#edf6ee",
    softAccent: "#c8e6d0",
  },
};

export function resolveDesignTokens(
  input?: Partial<DesignTokensV1> | null,
): DesignTokensV1 {
  return designTokensV1Schema.parse({
    ...DEFAULT_DESIGN_TOKENS,
    ...(input ?? {}),
    version: 1,
  });
}

export function resolveDesignTokenColors(
  tokens: DesignTokensV1,
  fallback?: Partial<DesignTokenColors>,
): DesignTokenColors {
  return {
    ...(fallback ?? {}),
    ...DESIGN_TOKEN_COLOR_SPECS[tokens.palette],
  };
}

export function resolveDesignTokenFontFamily(
  tokens: DesignTokensV1,
  fallback: "serif" | "sans" | "mono" = "sans",
): "serif" | "sans" | "mono" {
  if (tokens.fontMood === "technical") return "mono";
  if (tokens.fontMood === "editorial" || tokens.fontMood === "formal") return "serif";
  if (tokens.fontMood === "minimal") return "sans";
  return fallback;
}

export function resolveDesignTokenBackgroundVariant(
  tokens: DesignTokensV1,
  fallback: BackgroundVariant,
): BackgroundVariant {
  if (tokens.backgroundStyle === "dark" || tokens.backgroundStyle === "gradient") {
    return "hero";
  }
  if (tokens.backgroundStyle === "paper") {
    return "muted";
  }
  return fallback;
}

export function isDarkDesignTokens(tokens: DesignTokensV1): boolean {
  return tokens.palette === "tech-dark" || tokens.backgroundStyle === "dark";
}
