import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { CONTENT, layoutSpacing, styleText } from "./utils";

type ComparisonVariant = "split" | "before-after" | "verdict";

function resolveVariant(ctx: LayoutGrammarContext): ComparisonVariant {
  if (LAYOUT_GRAMMAR_VARIANTS.comparison.includes(ctx.grammarVariant as ComparisonVariant)) {
    return ctx.grammarVariant as ComparisonVariant;
  }
  if (ctx.style.layoutTokens.shapeLanguage === "path") return "before-after";
  if (ctx.style.layoutTokens.density === "calm") return "verdict";
  return "split";
}

function columns(ctx: LayoutGrammarContext, variant: ComparisonVariant): void {
  const left = ctx.bodyTexts.filter((_, index) => index % 2 === 0);
  const right = ctx.bodyTexts.filter((_, index) => index % 2 === 1);
  const spacing = layoutSpacing(ctx);
  const gap = variant === "before-after"
    ? Math.max(64, Math.round(spacing.gutter * 1.8))
    : Math.max(32, spacing.gutter);
  const width = (CONTENT.width - gap) / 2;
  const leftX = CONTENT.x;
  const rightX = CONTENT.x + width + gap;
  ctx.elements.push(ctx.helpers.createCard(leftX, CONTENT.y, width, CONTENT.height));
  ctx.elements.push(ctx.helpers.createCard(rightX, CONTENT.y, width, CONTENT.height));
  ctx.elements.push(ctx.helpers.createAccentBlock(
    leftX + spacing.padding,
    CONTENT.y + spacing.compactPadding,
    48,
    48,
    { opacity: variant === "verdict" ? 0.25 : 1 },
  ));
  ctx.elements.push(ctx.helpers.createAccentBlock(
    rightX + spacing.padding,
    CONTENT.y + spacing.compactPadding,
    48,
    48,
    { opacity: 1 },
  ));

  const place = (items: typeof left, x: number) => {
    const reservedBottom = variant === "verdict" ? spacing.padding + 20 : 0;
    const textTop = spacing.compactPadding + 64;
    const height = (
      CONTENT.height - textTop - spacing.compactPadding - reservedBottom
    ) / Math.max(1, items.length);
    items.forEach((element, index) => {
      ctx.elements.push(styleText(ctx, element, {
        x: x + spacing.padding,
        y: CONTENT.y + textTop + index * height,
        width: width - spacing.padding * 2,
        height: height - Math.max(6, spacing.gutter * 0.2),
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
    ctx.elements.push(ctx.helpers.createAccentBar(
      rightX + spacing.padding,
      CONTENT.y + CONTENT.height - spacing.compactPadding,
      width - spacing.padding * 2,
    ));
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
