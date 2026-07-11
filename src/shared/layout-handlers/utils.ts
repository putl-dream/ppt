import type { ImageElement, ShapeElement, TextElement } from "../presentation";
import type { LayoutGrammarContext } from "../layout-grammar";
import { fitFontSize } from "../layout-text-fit";
import { VISUAL_TOKENS } from "../visual-tokens";

export const CONTENT = { x: 120, y: 188, width: 1040, height: 448 } as const;

export function grammarId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function densityScale(ctx: LayoutGrammarContext): number {
  if (ctx.designTokens.density === "calm") return 1.12;
  if (ctx.designTokens.density === "dense") return 0.88;
  return 1;
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
      Math.round(input.baseSize * densityScale(ctx)),
      input.minSize ?? 14,
    ),
    bold: input.bold,
    color: input.color ?? ctx.colors.body,
    align: input.align ?? "left",
    provenance: "layout",
  }, input.role ?? "body");
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
  const styled = ctx.helpers.assignTextRole(element, input.role ?? "body");
  styled.x = input.x;
  styled.y = input.y;
  styled.width = input.width;
  styled.height = input.height;
  styled.fontSize = fitFontSize(
    styled.text,
    input.width,
    input.height,
    Math.round(input.baseSize * densityScale(ctx)),
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
  if (!ctx.hasExplicitDesignTokens) return image;
  const treatment = ctx.designTokens.imageTreatment;
  return {
    ...image,
    imageTreatment: treatment,
    borderRadius: treatment === "masked"
      ? VISUAL_TOKENS.radii.pill
      : treatment === "framed" || treatment === "captioned"
        ? VISUAL_TOKENS.radii.md
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
