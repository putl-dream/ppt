import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import {
  CONTENT,
  layoutSpacing,
  pickAnyImage,
  styleText,
} from "./utils";

type ConceptVariant = "cards" | "statement-stack" | "editorial-columns";

function resolveVariant(ctx: LayoutGrammarContext): ConceptVariant {
  if (LAYOUT_GRAMMAR_VARIANTS.concept.includes(ctx.grammarVariant as ConceptVariant)) {
    return ctx.grammarVariant as ConceptVariant;
  }
  if (ctx.style.layoutTokens.shapeLanguage === "editorial") return "editorial-columns";
  if (ctx.style.layoutTokens.density === "calm") return "statement-stack";
  return "cards";
}

function cards(ctx: LayoutGrammarContext): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const spacing = layoutSpacing(ctx);
  const gap = spacing.gutter;
  const width = (CONTENT.width - gap * (count - 1)) / count;
  const images = ctx.imageElements.filter((image) => !ctx.placedImageIds.has(image.id));
  ctx.bodyTexts.forEach((element, index) => {
    const x = CONTENT.x + index * (width + gap);
    const padding = Math.min(spacing.padding, Math.max(12, width * 0.16));
    ctx.elements.push(ctx.helpers.createCard(x, CONTENT.y, width, CONTENT.height));
    ctx.elements.push(ctx.helpers.createAccentBar(
      x + padding,
      CONTENT.y + spacing.compactPadding,
      width - padding * 2,
    ));
    const image = ctx.helpers.pickImageForSlot(`grid-${index}`) ?? images.shift();
    const textTop = CONTENT.y + spacing.compactPadding + 28;
    const imageHeight = Math.round(92 * spacing.scale);
    const textHeight = image
      ? CONTENT.height - imageHeight - spacing.padding * 2 - 28
      : CONTENT.height - spacing.padding * 2 - 28;
    ctx.elements.push(styleText(ctx, element, {
      x: x + padding,
      y: textTop,
      width: width - padding * 2,
      height: textHeight,
      role: index === 0 ? "kicker" : "body", baseSize: 20, bold: index === 0,
    }));
    if (image) {
      ctx.elements.push(ctx.helpers.placeImageInSlot(image, {
        x: x + padding,
        y: CONTENT.y + CONTENT.height - imageHeight - spacing.compactPadding,
        width: width - padding * 2,
        height: imageHeight,
      }, `grid-${index}`));
    }
  });
}

function statementStack(ctx: LayoutGrammarContext): void {
  const spacing = layoutSpacing(ctx);
  ctx.elements.push(ctx.helpers.createCard(CONTENT.x, CONTENT.y, CONTENT.width, CONTENT.height));
  const count = Math.max(1, ctx.bodyTexts.length);
  const rowHeight = CONTENT.height / count;
  ctx.bodyTexts.forEach((element, index) => {
    const y = CONTENT.y + index * rowHeight;
    const inset = Math.min(
      spacing.compactPadding,
      Math.max(6, (rowHeight - 20) / 2),
    );
    ctx.elements.push(ctx.helpers.createAccentBlock(
      CONTENT.x + spacing.padding,
      y + inset,
      8,
      rowHeight - inset * 2,
      { opacity: 1 },
    ));
    ctx.elements.push(styleText(ctx, element, {
      x: CONTENT.x + spacing.padding + 32,
      y: y + inset,
      width: CONTENT.width - spacing.padding * 2 - 32,
      height: rowHeight - inset * 2,
      role: index === 0 ? "kicker" : "body", baseSize: index === 0 ? 26 : 20,
      bold: index === 0,
    }));
  });
}

function editorialColumns(ctx: LayoutGrammarContext): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const spacing = layoutSpacing(ctx);
  const gap = Math.max(12, Math.round(spacing.gutter * 0.65));
  const width = (CONTENT.width - gap * (count - 1)) / count;
  ctx.bodyTexts.forEach((element, index) => {
    const x = CONTENT.x + index * (width + gap);
    ctx.elements.push(ctx.helpers.createCard(x, CONTENT.y, width, CONTENT.height));
    ctx.elements.push(styleText(ctx, element, {
      x: x + spacing.padding,
      y: CONTENT.y + spacing.padding,
      width: width - spacing.padding * 2,
      height: CONTENT.height - spacing.padding * 2,
      role: index === 0 ? "kicker" : "body", baseSize: index === 0 ? 24 : 19,
      bold: index === 0,
    }));
  });
  const image = pickAnyImage(ctx, "side");
  if (image && count === 1) {
    ctx.elements.push(ctx.helpers.placeImageInSlot(image, {
      x: 760, y: CONTENT.y + 24, width: 360, height: CONTENT.height - 48,
    }, "side"));
  }
}

export const conceptGrammarHandler: LayoutGrammarHandler = {
  id: "concept",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.concept,
  defaultVariant: "cards",
  contentSlots: ["concept-0", "concept-1", "concept-2", "concept-3"],
  visualSlots: ["grid-0", "grid-1", "grid-2", "side"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    if (variant === "statement-stack") statementStack(ctx);
    else if (variant === "editorial-columns") editorialColumns(ctx);
    else cards(ctx);
    return variant;
  },
};

layoutGrammarRegistry.register(conceptGrammarHandler);
