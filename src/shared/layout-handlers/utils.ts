import type { ImageElement, ShapeElement, TextElement } from "../presentation";
import type { LayoutGrammarContext } from "../layout-grammar";
import { fitFontSize } from "../layout-text-fit";

export const CONTENT = { x: 120, y: 188, width: 1040, height: 448 } as const;

export function grammarId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function densityScale(ctx: LayoutGrammarContext): number {
  if (ctx.style.density === "calm") return 1.12;
  if (ctx.style.density === "dense") return 0.88;
  return 1;
}

export function typographyScale(
  ctx: LayoutGrammarContext,
  role: "kicker" | "body" | "metric" | "caption",
): number {
  const roleScale = role === "kicker"
    ? ctx.style.typography.heading.scale
    : role === "metric"
      ? ctx.style.typography.data.scale
      : ctx.style.typography.body.scale;
  return densityScale(ctx) * roleScale;
}

/**
 * Convert the v2 whitespace model into executable layout measurements.
 *
 * Resolver spacing values already include reading-mode adaptation. Applying
 * `scale` here gives the composition itself (rather than only its metadata) a
 * visibly tighter or more expansive reading rhythm.
 */
export function layoutSpacing(ctx: LayoutGrammarContext): {
  gutter: number;
  padding: number;
  compactPadding: number;
  scale: number;
} {
  const scale = ctx.style.spacing.scale;
  const gutter = Math.max(12, Math.round(ctx.style.spacing.gutter * scale));
  const padding = Math.max(12, Math.round(ctx.style.spacing.cardPadding * scale));
  return {
    gutter,
    padding,
    compactPadding: Math.max(10, Math.round(padding * 0.72)),
    scale,
  };
}

export function layoutText(
  ctx: LayoutGrammarContext,
  input: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    role?: "kicker" | "body" | "metric" | "caption";
    baseSize: number;
    minSize?: number;
    bold?: boolean;
    color?: string;
    align?: "left" | "center" | "right";
    idPrefix?: string;
  },
): TextElement {
  const role = input.role ?? "body";
  return ctx.helpers.assignTextRole({
    id: grammarId(input.idPrefix ?? "grammar-text"),
    type: "text",
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    text: input.text,
    fontSize: fitFontSize(
      input.text,
      input.width,
      input.height,
      Math.round(input.baseSize * typographyScale(ctx, role)),
      input.minSize ?? 14,
    ),
    bold: input.bold,
    color: input.color ?? ctx.colors.body,
    align: input.align ?? "left",
    provenance: "layout",
  }, role);
}

export function styleText(
  ctx: LayoutGrammarContext,
  element: TextElement,
  input: {
    x: number;
    y: number;
    width: number;
    height: number;
    role?: "kicker" | "body" | "metric" | "caption";
    baseSize: number;
    minSize?: number;
    bold?: boolean;
    color?: string;
    align?: "left" | "center" | "right";
  },
): TextElement {
  const role = input.role ?? "body";
  const styled = ctx.helpers.assignTextRole(element, role);
  styled.x = input.x;
  styled.y = input.y;
  styled.width = input.width;
  styled.height = input.height;
  styled.fontSize = fitFontSize(
    styled.text,
    input.width,
    input.height,
    Math.round(input.baseSize * typographyScale(ctx, role)),
    input.minSize ?? 14,
  );
  styled.bold = input.bold ?? false;
  styled.color = input.color ?? ctx.colors.body;
  styled.align = input.align ?? "left";
  return styled;
}

export function pickAnyImage(
  ctx: LayoutGrammarContext,
  preferredSlot?: string,
): ImageElement | undefined {
  return (preferredSlot ? ctx.helpers.pickImageForSlot(preferredSlot) : undefined)
    ?? ctx.imageElements.find((image) => !ctx.placedImageIds.has(image.id));
}

export function applyImageTreatment(
  image: ImageElement,
  ctx: LayoutGrammarContext,
): ImageElement {
  const treatment = ctx.style.image.treatment;
  return {
    ...image,
    imageTreatment: treatment,
    borderRadius: treatment === "masked"
      ? Math.max(0, ctx.style.shape.radius * 2)
      : treatment === "framed" || treatment === "captioned"
        ? Math.max(0, ctx.style.shape.radius)
        : image.borderRadius,
  };
}

export function lineShape(
  ctx: LayoutGrammarContext,
  x: number,
  y: number,
  width: number,
  height = 2,
  opacity = 0.7,
): ShapeElement {
  return {
    id: grammarId("motif-line"),
    type: "shape",
    shapeType: "line",
    x,
    y,
    width,
    height,
    fillColor: ctx.colors.accent,
    strokeColor: ctx.colors.accent,
    fillOpacity: opacity,
    provenance: "layout",
  };
}
