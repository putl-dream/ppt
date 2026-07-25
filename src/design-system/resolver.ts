import {
  fontFamilyToCss,
  fontFamilyToPptxFace,
  type FontFamily,
} from "@shared/typography";

import { resolveBackground, type ResolvedBackground } from "./backgrounds";
import {
  getReadingModeDefinition,
  getVisualStyleDefinition,
  type IllustrationPropensity,
  type ImageRendering,
  type VisualStyleDefinition,
} from "./catalog";
import {
  isDarkColor,
  isDarkColorScheme,
  resolveColors,
  type ResolvedColors,
} from "./colors";
import {
  resolveDesignTokens,
  type ChartStyle,
  type ColorOverrides,
  type Density,
  type DesignSystemV2,
  type DesignTokens,
  type ImageTreatment,
  type Motif,
  type ReadingMode,
  type SlideDesignOverride,
  type VisualStyle,
} from "./schema";

export interface SlideDesignInput {
  layout?: string;
  slideVariant?: "light" | "dark" | "hero";
  designOverride?: SlideDesignOverride;
}

export interface ResolvedTypographyRole {
  family: FontFamily;
  css: string;
  pptxFace: string;
  weight: number;
  scale: number;
  fontSize: number;
  tracking: number;
  lineHeight: number;
}

export interface ResolvedShapeStyle {
  language: DesignTokens["shapeLanguage"];
  radius: number;
  stroke: {
    width: number;
    style: VisualStyleDefinition["shape"]["strokeStyle"];
    color: string;
  };
  shadow?: string;
  elevation: VisualStyleDefinition["elevation"]["kind"];
}

export interface ResolvedSpacing {
  margin: number;
  gutter: number;
  sectionGap: number;
  cardPadding: number;
  scale: number;
  rhythm: VisualStyleDefinition["whitespace"]["rhythm"];
}

export interface ResolvedSlideStyle {
  /** Executable projection used by the current layout grammar. */
  layoutTokens: DesignTokens;
  argumentMode: DesignSystemV2["argumentMode"];
  readingMode: ReadingMode;
  visualStyle: VisualStyle;
  mode: "light" | "dark";
  colors: ResolvedColors;
  typography: {
    heading: ResolvedTypographyRole;
    body: ResolvedTypographyRole;
    data: ResolvedTypographyRole;
  };
  headingTypography: ResolvedTypographyRole;
  bodyTypography: ResolvedTypographyRole;
  shape: ResolvedShapeStyle;
  spacing: ResolvedSpacing;
  background: ResolvedBackground;
  image: {
    treatment: ImageTreatment;
    rendering: ImageRendering;
    illustrationPropensity: IllustrationPropensity;
  };
  chart: {
    style: ChartStyle;
    foreground: string;
    secondary: string;
    grid: string;
  };
  density: Density;
  motif: Motif;
  grammar: VisualStyleDefinition["grammarPreferences"];
  catalog: VisualStyleDefinition;
}

function mergeColorOverrides(
  deck?: ColorOverrides,
  slide?: ColorOverrides,
): ColorOverrides | undefined {
  if (!deck && !slide) return undefined;
  return { ...(deck ?? {}), ...(slide ?? {}) };
}

function resolveMode(
  system: DesignSystemV2,
  definition: VisualStyleDefinition,
  slide: SlideDesignInput,
): "light" | "dark" {
  if (slide.slideVariant === "light") return "light";
  if (slide.slideVariant === "dark") return "dark";
  const slideBackground = slide.designOverride?.colors?.background
    ?? slide.designOverride?.colors?.bg;
  const deckBackground = system.colors?.background ?? system.colors?.bg;
  if (slideBackground) return isDarkColor(slideBackground) ? "dark" : "light";
  if (deckBackground) return isDarkColor(deckBackground) ? "dark" : "light";
  if (definition.background.field === "dark") return "dark";
  if (definition.background.field === "light") return "light";
  return isDarkColorScheme(slide.designOverride?.colorScheme ?? system.colorScheme)
    ? "dark"
    : "light";
}

function resolveTypographyRole(
  family: FontFamily,
  weight: number,
  scale: number,
  fontSize: number,
  tracking: number,
  lineHeight: number,
): ResolvedTypographyRole {
  return {
    family,
    css: fontFamilyToCss(family),
    pptxFace: fontFamilyToPptxFace(family),
    weight,
    scale,
    fontSize: Math.round(fontSize * 10) / 10,
    tracking,
    lineHeight,
  };
}

function rgba(hex: string, opacity: number): string {
  const values = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${opacity})`;
}

function resolveShadow(
  definition: VisualStyleDefinition,
  colors: ResolvedColors,
): string | undefined {
  const shadow = definition.elevation.shadow;
  if (!shadow || definition.elevation.kind === "flat") return undefined;
  const color = definition.elevation.kind === "glow" ? colors.accent : colors.scrim;
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${rgba(color, shadow.opacity)}`;
}

function scaled(value: number, scale: number): number {
  return Math.round(value * scale);
}

export function resolveSlideStyle(
  system: DesignSystemV2,
  slide: SlideDesignInput,
): ResolvedSlideStyle {
  const visualStyle = slide.designOverride?.visualStyle ?? system.visualStyle;
  const readingMode = slide.designOverride?.readingMode ?? system.readingMode;
  const colorScheme = slide.designOverride?.colorScheme ?? system.colorScheme;
  const definition = getVisualStyleDefinition(visualStyle);
  const reading = getReadingModeDefinition(readingMode);
  const layoutTokens = resolveDesignTokens(system, slide.designOverride);
  const mode = resolveMode(system, definition, slide);
  const colors = resolveColors(
    colorScheme,
    mode,
    mergeColorOverrides(system.colors, slide.designOverride?.colors),
  );

  const heading = resolveTypographyRole(
    definition.typography.headingFamily,
    definition.typography.headingWeight,
    definition.typography.headingScale * reading.typographyScale,
    44 * definition.typography.headingScale * reading.typographyScale,
    definition.typography.tracking,
    definition.typography.lineHeight,
  );
  const body = resolveTypographyRole(
    definition.typography.bodyFamily,
    definition.typography.bodyWeight,
    definition.typography.bodyScale * reading.typographyScale,
    reading.bodySize * definition.typography.bodyScale,
    definition.typography.tracking,
    definition.typography.lineHeight,
  );
  const data = resolveTypographyRole(
    definition.typography.dataFamily,
    Math.max(definition.typography.bodyWeight, 500),
    definition.typography.bodyScale * reading.typographyScale,
    reading.bodySize * definition.typography.bodyScale,
    Math.max(definition.typography.tracking, 0),
    definition.typography.lineHeight,
  );
  const spacing: ResolvedSpacing = {
    margin: scaled(definition.whitespace.margin, reading.spacingScale),
    gutter: scaled(definition.whitespace.gutter, reading.spacingScale),
    sectionGap: scaled(definition.whitespace.sectionGap, reading.spacingScale),
    cardPadding: scaled(definition.whitespace.cardPadding, reading.spacingScale),
    scale: reading.spacingScale,
    rhythm: definition.whitespace.rhythm,
  };

  return {
    layoutTokens,
    argumentMode: system.argumentMode,
    readingMode,
    visualStyle,
    mode,
    colors,
    typography: { heading, body, data },
    headingTypography: heading,
    bodyTypography: body,
    shape: {
      language: layoutTokens.shapeLanguage,
      radius: definition.shape.radius,
      stroke: {
        width: definition.shape.strokeWidth,
        style: definition.shape.strokeStyle,
        color: colors.grid,
      },
      shadow: resolveShadow(definition, colors),
      elevation: definition.elevation.kind,
    },
    spacing,
    background: resolveBackground(layoutTokens, colors, mode, definition),
    image: {
      treatment: layoutTokens.imageTreatment,
      rendering: definition.imageRendering,
      illustrationPropensity: definition.illustrationPropensity,
    },
    chart: {
      style: layoutTokens.chartStyle,
      foreground: colors.accent,
      secondary: colors.secondaryAccent,
      grid: colors.grid,
    },
    density: layoutTokens.density,
    motif: layoutTokens.motif,
    grammar: definition.grammarPreferences,
    catalog: definition,
  };
}
