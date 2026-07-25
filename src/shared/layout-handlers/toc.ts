import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import {
  CONTENT,
  layoutSpacing,
  layoutText,
  styleText,
} from "./utils";

type TocVariant = "numbered-list" | "chapter-rail" | "editorial-index";

function resolveVariant(ctx: LayoutGrammarContext): TocVariant {
  if (LAYOUT_GRAMMAR_VARIANTS.toc.includes(ctx.grammarVariant as TocVariant)) {
    return ctx.grammarVariant as TocVariant;
  }
  if (ctx.style.layoutTokens.fontMood === "editorial") return "editorial-index";
  if (ctx.style.layoutTokens.motif === "chapter-number") return "chapter-rail";
  return "numbered-list";
}

function numberedList(ctx: LayoutGrammarContext): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const spacing = layoutSpacing(ctx);
  const gap = Math.max(8, Math.round(spacing.gutter * 0.4));
  const rowHeight = (CONTENT.height - gap * (count - 1)) / count;
  ctx.bodyTexts.forEach((element, index) => {
    const y = CONTENT.y + index * (rowHeight + gap);
    ctx.elements.push(ctx.helpers.createCard(CONTENT.x, y, CONTENT.width, rowHeight));
    const badgeX = CONTENT.x + spacing.padding;
    ctx.elements.push(ctx.helpers.createStepBadge(badgeX, y + (rowHeight - 36) / 2, 36));
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1).padStart(2, "0"),
      x: badgeX,
      y: y + (rowHeight - 36) / 2,
      width: 36, height: 36, role: "caption", baseSize: 14, bold: true,
      color: ctx.colors.bg, align: "center", idPrefix: "num",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: badgeX + 36 + spacing.compactPadding,
      y: y + Math.max(6, spacing.compactPadding / 2),
      width: CONTENT.width - spacing.padding * 2 - 36 - spacing.compactPadding,
      height: rowHeight - Math.max(12, spacing.compactPadding),
      role: "body", baseSize: 22,
    }));
  });
}

function chapterRail(ctx: LayoutGrammarContext): void {
  const spacing = layoutSpacing(ctx);
  ctx.elements.push(ctx.helpers.createCard(CONTENT.x, CONTENT.y, CONTENT.width, CONTENT.height));
  const railX = CONTENT.x + spacing.padding;
  ctx.elements.push(ctx.helpers.createAccentBlock(
    railX,
    CONTENT.y + spacing.compactPadding,
    8,
    CONTENT.height - spacing.compactPadding * 2,
    { opacity: 1 },
  ));
  const count = Math.max(1, ctx.bodyTexts.length);
  const rowHeight = CONTENT.height / count;
  ctx.bodyTexts.forEach((element, index) => {
    const y = CONTENT.y + index * rowHeight;
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1).padStart(2, "0"),
      x: railX + 34,
      y: y + spacing.compactPadding / 2,
      width: 82, height: rowHeight - 24, role: "metric", baseSize: 28,
      bold: true, color: ctx.colors.accent, idPrefix: "toc-chapter",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: railX + 136,
      y: y + spacing.compactPadding / 2,
      width: CONTENT.x + CONTENT.width - spacing.padding - (railX + 136),
      height: rowHeight - spacing.compactPadding,
      role: "body", baseSize: 22,
    }));
  });
}

function editorialIndex(ctx: LayoutGrammarContext): void {
  const count = Math.max(1, ctx.bodyTexts.length);
  const spacing = layoutSpacing(ctx);
  const columns = Math.min(2, count);
  const rows = Math.ceil(count / columns);
  const gap = spacing.gutter;
  const width = columns === 1 ? CONTENT.width : (CONTENT.width - gap) / 2;
  const height = (CONTENT.height - gap * (rows - 1)) / rows;
  ctx.bodyTexts.forEach((element, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = CONTENT.x + column * (width + gap);
    const y = CONTENT.y + row * (height + gap);
    ctx.elements.push(ctx.helpers.createCard(x, y, width, height));
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1),
      x: x + spacing.padding,
      y: y + spacing.compactPadding,
      width: 72,
      height: 54,
      role: "metric", baseSize: 34, bold: true, color: ctx.colors.accent,
      idPrefix: "toc-index",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: x + spacing.padding + 80,
      y: y + spacing.compactPadding,
      width: width - spacing.padding * 2 - 80,
      height: height - spacing.compactPadding * 2,
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
