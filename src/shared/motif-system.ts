import type { ShapeElement } from "./presentation";
import type { Motif, ResolvedSlideStyle } from "@design-system";
import { VISUAL_TOKENS } from "./visual-tokens";

export interface MotifColors {
  bg: string;
  accent: string;
  cardBg: string;
  cardStroke: string;
}

export interface CoverMotifInput {
  motif: Motif;
  colors: MotifColors;
  variant: "centered" | "editorial-hero" | "signal-dark";
  style: ResolvedSlideStyle;
}

const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15);
};

const LINE_MOTIF_HEIGHT = 2;

function layoutShape(
  shape: Omit<ShapeElement, "id" | "type" | "provenance"> & { id?: string },
): ShapeElement {
  return {
    ...shape,
    id: shape.id ?? `motif-${generateId()}`,
    type: "shape",
    provenance: "layout",
  };
}

function motifRadius(
  style: ResolvedSlideStyle | undefined,
  maxRadius = Number.POSITIVE_INFINITY,
): number {
  return Math.min(maxRadius, Math.max(0, style?.shape.radius ?? 0));
}

function motifStroke(
  style: ResolvedSlideStyle | undefined,
  fallback: string,
): string {
  if (!style) return fallback;
  return style.shape.stroke.width > 0
    ? style.shape.stroke.color
    : "transparent";
}

function motifShadow(
  style: ResolvedSlideStyle | undefined,
): ShapeElement["shadow"] {
  if (!style?.shape.shadow) return undefined;
  const shadow = style.catalog.elevation.shadow;
  if (!shadow) return undefined;
  return {
    color: style.shape.elevation === "glow"
      ? style.colors.accent
      : style.colors.scrim,
    blur: shadow.blur,
    offsetX: shadow.x,
    offsetY: shadow.y,
    opacity: shadow.opacity,
  };
}

export function createBookmarkMotif(
  colors: MotifColors,
  style?: ResolvedSlideStyle,
): ShapeElement[] {
  const radius = motifRadius(style, VISUAL_TOKENS.motif.bookmark.width / 2);
  return [
    layoutShape({
      shapeType: radius > 0 ? "roundedRect" : "rectangle",
      x: 84,
      y: 90,
      width: VISUAL_TOKENS.motif.bookmark.width,
      height: 510,
      fillColor: colors.accent,
      strokeColor: motifStroke(style, colors.accent),
      cornerRadius: radius,
      shadow: motifShadow(style),
    }),
    layoutShape({
      shapeType: radius > 0 ? "roundedRect" : "rectangle",
      x: 112,
      y: 90,
      width: 8,
      height: 360,
      fillColor: colors.cardStroke,
      strokeColor: motifStroke(style, colors.cardStroke),
      cornerRadius: radius,
      fillOpacity: 0.7,
    }),
  ];
}

export function createArcMotif(
  colors: MotifColors,
  style?: ResolvedSlideStyle,
): ShapeElement[] {
  return [
    layoutShape({
      shapeType: "circle",
      x: 820,
      y: 86,
      width: 360,
      height: 360,
      fillColor: colors.accent,
      strokeColor: motifStroke(style, colors.accent),
      fillOpacity: 0.1,
    }),
    layoutShape({
      shapeType: "circle",
      x: 898,
      y: 164,
      width: 204,
      height: 204,
      fillColor: colors.bg,
      strokeColor: motifStroke(style, colors.cardStroke),
      fillOpacity: 0.18,
    }),
  ];
}

export function createMarginNoteMotif(
  colors: MotifColors,
  style?: ResolvedSlideStyle,
): ShapeElement[] {
  const radius = motifRadius(style);
  return [
    layoutShape({
      shapeType: radius > 0 ? "roundedRect" : "rectangle",
      x: 948,
      y: 116,
      width: VISUAL_TOKENS.motif.marginNote.width,
      height: 420,
      fillColor: colors.cardBg,
      strokeColor: motifStroke(style, colors.cardStroke),
      cornerRadius: radius,
      fillOpacity: 0.78,
      shadow: motifShadow(style),
    }),
    layoutShape({
      shapeType: "line",
      x: 972,
      y: 154,
      width: 132,
      height: LINE_MOTIF_HEIGHT,
      fillColor: colors.accent,
      strokeColor: motifStroke(style, colors.accent),
      fillOpacity: 0.9,
    }),
  ];
}

export function createPathLineMotif(
  colors: MotifColors,
  style?: ResolvedSlideStyle,
): ShapeElement[] {
  return [
    layoutShape({
      shapeType: "line",
      x: 160,
      y: 590,
      width: 820,
      height: LINE_MOTIF_HEIGHT,
      fillColor: colors.accent,
      strokeColor: motifStroke(style, colors.accent),
      fillOpacity: 0.8,
    }),
    layoutShape({
      shapeType: "circle",
      x: 970,
      y: 578,
      width: 24,
      height: 24,
      fillColor: colors.accent,
      strokeColor: motifStroke(style, colors.accent),
    }),
  ];
}

export function createCoverMotif(input: CoverMotifInput): ShapeElement[] {
  if (input.motif === "bookmark") return createBookmarkMotif(input.colors, input.style);
  if (input.motif === "arc") return createArcMotif(input.colors, input.style);
  if (input.motif === "margin-note") return createMarginNoteMotif(input.colors, input.style);
  if (input.motif === "path-line") return createPathLineMotif(input.colors, input.style);
  if (input.variant === "signal-dark") return createArcMotif(input.colors, input.style);
  if (input.variant === "editorial-hero") {
    return createBookmarkMotif(input.colors, input.style);
  }
  return [];
}
