import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { CONTENT, layoutText, styleText } from "./utils";

type TocVariant = "numbered-list" | "chapter-rail" | "editorial-index";

function resolveVariant(ctx: LayoutGrammarContext): TocVariant {
  if (LAYOUT_GRAMMAR_VARIANTS.toc.includes(ctx.grammarVariant as TocVariant)) {
    return ctx.grammarVariant as TocVariant;
  }
  if (ctx.style.tokens.fontMood === "editorial") return "editorial-index";
  if (ctx.style.tokens.motif === "chapter-number") return "chapter-rail";
  return "numbered-list";
}

function numberedList(ctx: LayoutGrammarContext): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const gap = 12;
  const rowHeight = (CONTENT.height - gap * (count - 1)) / count;
  ctx.bodyTexts.forEach((element, index) => {
    const y = CONTENT.y + index * (rowHeight + gap);
    ctx.elements.push(ctx.helpers.createCard(CONTENT.x, y, CONTENT.width, rowHeight));
    ctx.elements.push(ctx.helpers.createStepBadge(140, y + (rowHeight - 36) / 2, 36));
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1).padStart(2, "0"), x: 140, y: y + (rowHeight - 36) / 2,
      width: 36, height: 36, role: "caption", baseSize: 14, bold: true,
      color: ctx.colors.bg, align: "center", idPrefix: "num",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: 196, y: y + 8, width: 920, height: rowHeight - 16,
      role: "body", baseSize: 22,
    }));
  });
}

function chapterRail(ctx: LayoutGrammarContext): void {
  ctx.elements.push(ctx.helpers.createCard(CONTENT.x, CONTENT.y, CONTENT.width, CONTENT.height));
  ctx.elements.push(ctx.helpers.createAccentBlock(150, CONTENT.y + 24, 8, CONTENT.height - 48, { opacity: 1 }));
  const count = Math.max(1, ctx.bodyTexts.length);
  const rowHeight = CONTENT.height / count;
  ctx.bodyTexts.forEach((element, index) => {
    const y = CONTENT.y + index * rowHeight;
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1).padStart(2, "0"), x: 184, y: y + 12,
      width: 82, height: rowHeight - 24, role: "metric", baseSize: 28,
      bold: true, color: ctx.colors.accent, idPrefix: "toc-chapter",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: 286, y: y + 12, width: 820, height: rowHeight - 24,
      role: "body", baseSize: 22,
    }));
  });
}

function editorialIndex(ctx: LayoutGrammarContext): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const columns = Math.min(2, count);
  const rows = Math.ceil(count / columns);
  const gap = 24;
  const width = (CONTENT.width - gap) / 2;
  const height = (CONTENT.height - gap * (rows - 1)) / rows;
  ctx.bodyTexts.forEach((element, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = CONTENT.x + column * (width + gap);
    const y = CONTENT.y + row * (height + gap);
    ctx.elements.push(ctx.helpers.createCard(x, y, width, height));
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1), x: x + 24, y: y + 20, width: 72, height: 54,
      role: "metric", baseSize: 34, bold: true, color: ctx.colors.accent,
      idPrefix: "toc-index",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: x + 104, y: y + 20, width: width - 132, height: height - 40,
      role: index === 0 ? "kicker" : "body", baseSize: 20, bold: index === 0,
    }));
  });
}

export const tocGrammarHandler: LayoutGrammarHandler = {
  id: "toc",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.toc,
  defaultVariant: "numbered-list",
  contentSlots: ["item-0", "item-1", "item-2", "item-3", "item-4", "item-5"],
  visualSlots: ["chapter-number", "rail"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    if (variant === "chapter-rail") chapterRail(ctx);
    else if (variant === "editorial-index") editorialIndex(ctx);
    else numberedList(ctx);
    return variant;
  },
};

layoutGrammarRegistry.register(tocGrammarHandler);
