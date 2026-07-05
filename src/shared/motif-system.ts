import type { ShapeElement } from "./presentation";
import type { Motif } from "./design-tokens";
import { VISUAL_TOKENS, cardShadow } from "./visual-tokens";

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
}

const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15);
};

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

export function createBookmarkMotif(colors: MotifColors): ShapeElement[] {
  return [
    layoutShape({
      shapeType: "roundedRect",
      x: 84,
      y: 90,
      width: VISUAL_TOKENS.motif.bookmark.width,
      height: 510,
      fillColor: colors.accent,
      strokeColor: colors.accent,
      cornerRadius: VISUAL_TOKENS.radii.pill,
      shadow: cardShadow("sm"),
    }),
    layoutShape({
      shapeType: "roundedRect",
      x: 112,
      y: 90,
      width: 8,
      height: 360,
      fillColor: colors.cardStroke,
      strokeColor: colors.cardStroke,
      cornerRadius: VISUAL_TOKENS.radii.pill,
      fillOpacity: 0.7,
    }),
  ];
}

export function createArcMotif(colors: MotifColors): ShapeElement[] {
  return [
    layoutShape({
      shapeType: "circle",
      x: 820,
      y: 86,
      width: 360,
      height: 360,
      fillColor: colors.accent,
      strokeColor: colors.accent,
      fillOpacity: 0.1,
    }),
    layoutShape({
      shapeType: "circle",
      x: 898,
      y: 164,
      width: 204,
      height: 204,
      fillColor: colors.bg,
      strokeColor: colors.cardStroke,
      fillOpacity: 0.18,
    }),
  ];
}

export function createMarginNoteMotif(colors: MotifColors): ShapeElement[] {
  return [
    layoutShape({
      shapeType: "roundedRect",
      x: 948,
      y: 116,
      width: VISUAL_TOKENS.motif.marginNote.width,
      height: 420,
      fillColor: colors.cardBg,
      strokeColor: colors.cardStroke,
      cornerRadius: VISUAL_TOKENS.radii.sm,
      fillOpacity: 0.78,
      shadow: cardShadow("sm"),
    }),
    layoutShape({
      shapeType: "line",
      x: 972,
      y: 154,
      width: 132,
      height: 0,
      fillColor: colors.accent,
      strokeColor: colors.accent,
      fillOpacity: 0.9,
    }),
  ];
}

export function createPathLineMotif(colors: MotifColors): ShapeElement[] {
  return [
    layoutShape({
      shapeType: "line",
      x: 160,
      y: 590,
      width: 820,
      height: 0,
      fillColor: colors.accent,
      strokeColor: colors.accent,
      fillOpacity: 0.8,
    }),
    layoutShape({
      shapeType: "circle",
      x: 970,
      y: 578,
      width: 24,
      height: 24,
      fillColor: colors.accent,
      strokeColor: colors.accent,
    }),
  ];
}

export function createCoverMotif(input: CoverMotifInput): ShapeElement[] {
  if (input.motif === "bookmark") return createBookmarkMotif(input.colors);
  if (input.motif === "arc") return createArcMotif(input.colors);
  if (input.motif === "margin-note") return createMarginNoteMotif(input.colors);
  if (input.motif === "path-line") return createPathLineMotif(input.colors);
  if (input.variant === "signal-dark") return createArcMotif(input.colors);
  if (input.variant === "editorial-hero") return createBookmarkMotif(input.colors);
  return [];
}
