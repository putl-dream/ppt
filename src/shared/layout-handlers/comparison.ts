import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { CONTENT, styleText } from "./utils";

type ComparisonVariant = "split" | "before-after" | "verdict";

function resolveVariant(ctx: LayoutGrammarContext): ComparisonVariant {
  if (LAYOUT_GRAMMAR_VARIANTS.comparison.includes(ctx.grammarVariant as ComparisonVariant)) {
    return ctx.grammarVariant as ComparisonVariant;
  }
  if (ctx.style.tokens.shapeLanguage === "path") return "before-after";
  if (ctx.style.tokens.density === "calm") return "verdict";
  return "split";
}

function columns(ctx: LayoutGrammarContext, variant: ComparisonVariant): void {
  const left = ctx.bodyTexts.filter((_, index) => index % 2 === 0);
  const right = ctx.bodyTexts.filter((_, index) => index % 2 === 1);
  const gap = variant === "before-after" ? 80 : 48;
  const width = (CONTENT.width - gap) / 2;
  const leftX = CONTENT.x;
  const rightX = CONTENT.x + width + gap;
  ctx.elements.push(ctx.helpers.createCard(leftX, CONTENT.y, width, CONTENT.height));
  ctx.elements.push(ctx.helpers.createCard(rightX, CONTENT.y, width, CONTENT.height));
  ctx.elements.push(ctx.helpers.createAccentBlock(leftX + 24, CONTENT.y + 24, 48, 48, { opacity: variant === "verdict" ? 0.25 : 1 }));
  ctx.elements.push(ctx.helpers.createAccentBlock(rightX + 24, CONTENT.y + 24, 48, 48, { opacity: 1 }));

  const place = (items: typeof left, x: number) => {
    const reservedBottom = variant === "verdict" ? 48 : 0;
    const height = (CONTENT.height - 96 - reservedBottom) / Math.max(1, items.length);
    items.forEach((element, index) => {
      ctx.elements.push(styleText(ctx, element, {
        x: x + 28, y: CONTENT.y + 88 + index * height,
        width: width - 56, height: height - 8,
        role: index === 0 ? "kicker" : "body", baseSize: index === 0 ? 22 : 19,
        bold: index === 0,
      }));
    });
  };
  place(left, leftX);
  place(right, rightX);

  if (variant === "before-after") {
    ctx.elements.push(ctx.helpers.createProcessArrow(leftX + width + 16, CONTENT.y + 202, gap - 32, 44));
  }
  if (variant === "verdict") {
    ctx.elements.push(ctx.helpers.createAccentBar(rightX + 28, CONTENT.y + CONTENT.height - 32, width - 56));
  }
}

export const comparisonGrammarHandler: LayoutGrammarHandler = {
  id: "comparison",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.comparison,
  defaultVariant: "split",
  contentSlots: ["left", "right"],
  visualSlots: ["transition", "verdict"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    columns(ctx, variant);
    return variant;
  },
};

layoutGrammarRegistry.register(comparisonGrammarHandler);
