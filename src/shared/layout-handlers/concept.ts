import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { CONTENT, pickAnyImage, styleText } from "./utils";

type ConceptVariant = "cards" | "statement-stack" | "editorial-columns";

function resolveVariant(ctx: LayoutGrammarContext): ConceptVariant {
  if (LAYOUT_GRAMMAR_VARIANTS.concept.includes(ctx.grammarVariant as ConceptVariant)) {
    return ctx.grammarVariant as ConceptVariant;
  }
  if (ctx.style.tokens.shapeLanguage === "editorial") return "editorial-columns";
  if (ctx.style.tokens.density === "calm") return "statement-stack";
  return "cards";
}

function cards(ctx: LayoutGrammarContext): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const gap = 32;
  const width = (CONTENT.width - gap * (count - 1)) / count;
  const images = ctx.imageElements.filter((image) => !ctx.placedImageIds.has(image.id));
  ctx.bodyTexts.forEach((element, index) => {
    const x = CONTENT.x + index * (width + gap);
    ctx.elements.push(ctx.helpers.createCard(x, CONTENT.y, width, CONTENT.height));
    ctx.elements.push(ctx.helpers.createAccentBar(x + 28, CONTENT.y + 24, width - 56));
    const image = ctx.helpers.pickImageForSlot(`grid-${index}`) ?? images.shift();
    const textHeight = image ? 260 : 372;
    ctx.elements.push(styleText(ctx, element, {
      x: x + 28, y: CONTENT.y + 52, width: width - 56, height: textHeight,
      role: index === 0 ? "kicker" : "body", baseSize: 20, bold: index === 0,
    }));
    if (image) {
      ctx.elements.push(ctx.helpers.placeImageInSlot(image, {
        x: x + 28, y: CONTENT.y + 328, width: width - 56, height: 92,
      }, `grid-${index}`));
    }
  });
}

function statementStack(ctx: LayoutGrammarContext): void {
  ctx.elements.push(ctx.helpers.createCard(CONTENT.x, CONTENT.y, CONTENT.width, CONTENT.height));
  const count = Math.max(1, ctx.bodyTexts.length);
  const rowHeight = CONTENT.height / count;
  ctx.bodyTexts.forEach((element, index) => {
    const y = CONTENT.y + index * rowHeight;
    ctx.elements.push(ctx.helpers.createAccentBlock(CONTENT.x + 28, y + 22, 8, rowHeight - 44, { opacity: 1 }));
    ctx.elements.push(styleText(ctx, element, {
      x: CONTENT.x + 60, y: y + 18, width: CONTENT.width - 92, height: rowHeight - 36,
      role: index === 0 ? "kicker" : "body", baseSize: index === 0 ? 26 : 20,
      bold: index === 0,
    }));
  });
}

function editorialColumns(ctx: LayoutGrammarContext): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const width = CONTENT.width / count;
  ctx.bodyTexts.forEach((element, index) => {
    const x = CONTENT.x + index * width;
    ctx.elements.push(ctx.helpers.createCard(x + 8, CONTENT.y, width - 16, CONTENT.height));
    ctx.elements.push(styleText(ctx, element, {
      x: x + 32, y: CONTENT.y + 40, width: width - 64, height: CONTENT.height - 80,
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
