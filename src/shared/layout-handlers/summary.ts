import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { CONTENT, layoutText, styleText } from "./utils";

type SummaryVariant = "action-list" | "three-takeaways" | "closing-checklist";

function resolveVariant(ctx: LayoutGrammarContext): SummaryVariant {
  if (LAYOUT_GRAMMAR_VARIANTS.summary.includes(ctx.grammarVariant as SummaryVariant)) {
    return ctx.grammarVariant as SummaryVariant;
  }
  if (ctx.bodyTexts.length === 3) return "three-takeaways";
  if (ctx.style.tokens.shapeLanguage === "annotation") return "closing-checklist";
  return "action-list";
}

function actionList(ctx: LayoutGrammarContext, checklist: boolean): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const gap = 16;
  const height = (CONTENT.height - gap * (count - 1)) / count;
  const cardX = checklist ? 180 : CONTENT.x;
  const cardWidth = checklist ? 920 : CONTENT.width;
  ctx.bodyTexts.forEach((element, index) => {
    const y = CONTENT.y + index * (height + gap);
    ctx.elements.push(ctx.helpers.createCard(cardX, y, cardWidth, height));
    const badgeSize = Math.min(40, height - 20);
    const badgeX = cardX + 24;
    ctx.elements.push(ctx.helpers.createStepBadge(badgeX, y + (height - badgeSize) / 2, badgeSize));
    ctx.elements.push(layoutText(ctx, {
      text: checklist ? "✓" : String(index + 1),
      x: badgeX, y: y + (height - badgeSize) / 2, width: badgeSize, height: badgeSize,
      role: "caption", baseSize: 17, bold: true, color: ctx.colors.bg,
      align: "center", idPrefix: "num",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: cardX + 88, y: y + 10, width: cardWidth - 120, height: height - 20,
      role: index === 0 ? "kicker" : "body", baseSize: 21, bold: index === 0,
    }));
  });
}

function threeTakeaways(ctx: LayoutGrammarContext): void {
  const gap = 28;
  const width = (CONTENT.width - gap * 2) / 3;
  ctx.bodyTexts.slice(0, 3).forEach((element, index) => {
    const x = CONTENT.x + index * (width + gap);
    ctx.elements.push(ctx.helpers.createCard(x, CONTENT.y, width, CONTENT.height));
    ctx.elements.push(layoutText(ctx, {
      text: `0${index + 1}`, x: x + 28, y: CONTENT.y + 28, width: 80, height: 56,
      role: "metric", baseSize: 30, bold: true, color: ctx.colors.accent,
      idPrefix: "summary-number",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: x + 28, y: CONTENT.y + 112, width: width - 56, height: CONTENT.height - 148,
      role: index === 0 ? "kicker" : "body", baseSize: 20, bold: index === 0,
    }));
  });
}

export const summaryGrammarHandler: LayoutGrammarHandler = {
  id: "summary",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.summary,
  defaultVariant: "action-list",
  contentSlots: ["takeaway-0", "takeaway-1", "takeaway-2"],
  visualSlots: ["marker", "closing-motif"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    if (variant === "three-takeaways") threeTakeaways(ctx);
    else actionList(ctx, variant === "closing-checklist");
    return variant;
  },
};

layoutGrammarRegistry.register(summaryGrammarHandler);
