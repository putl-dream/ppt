import { z } from "zod";

export const DESIGN_PALETTES = [
  "business-blue",
  "warm-paper",
  "mono-report",
  "tech-dark",
  "soft-academic",
] as const;
export const FONT_MOODS = ["formal", "editorial", "technical", "warm", "minimal"] as const;
export const SHAPE_LANGUAGES = ["cards", "annotation", "geometric", "path", "editorial"] as const;
export const BACKGROUND_STYLES = ["clean", "paper", "grid", "gradient", "dark"] as const;
export const MOTIFS = ["none", "bookmark", "chapter-number", "arc", "path-line", "margin-note"] as const;
export const DENSITIES = ["calm", "standard", "dense"] as const;
export const IMAGE_TREATMENTS = ["plain", "framed", "masked", "captioned"] as const;
export const CHART_STYLES = ["minimal", "report", "dashboard", "editorial"] as const;

export const designTokensSchema = z.object({
  palette: z.enum(DESIGN_PALETTES),
  fontMood: z.enum(FONT_MOODS),
  shapeLanguage: z.enum(SHAPE_LANGUAGES),
  backgroundStyle: z.enum(BACKGROUND_STYLES),
  motif: z.enum(MOTIFS),
  density: z.enum(DENSITIES),
  imageTreatment: z.enum(IMAGE_TREATMENTS),
  chartStyle: z.enum(CHART_STYLES),
});

export const designSystemV1Schema = z.object({
  version: z.literal(1),
  tokens: designTokensSchema,
});

export const slideDesignOverrideSchema = designTokensSchema.partial();

export type DesignTokens = z.infer<typeof designTokensSchema>;
export type DesignSystemV1 = z.infer<typeof designSystemV1Schema>;
export type SlideDesignOverride = z.infer<typeof slideDesignOverrideSchema>;
export type DesignPalette = (typeof DESIGN_PALETTES)[number];
export type FontMood = (typeof FONT_MOODS)[number];
export type ShapeLanguage = (typeof SHAPE_LANGUAGES)[number];
export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number];
export type Motif = (typeof MOTIFS)[number];
export type Density = (typeof DENSITIES)[number];
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];
export type ChartStyle = (typeof CHART_STYLES)[number];

export const DEFAULT_DESIGN_SYSTEM: DesignSystemV1 = {
  version: 1,
  tokens: {
    palette: "business-blue",
    fontMood: "formal",
    shapeLanguage: "cards",
    backgroundStyle: "clean",
    motif: "none",
    density: "standard",
    imageTreatment: "plain",
    chartStyle: "minimal",
  },
};

export function parseDesignSystem(input: unknown): DesignSystemV1 {
  return designSystemV1Schema.parse(input);
}

export function resolveDesignTokens(
  system: DesignSystemV1,
  override?: SlideDesignOverride,
): DesignTokens {
  return designTokensSchema.parse({ ...system.tokens, ...(override ?? {}) });
}
