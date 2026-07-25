import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import {
  CONTENT,
  layoutSpacing,
  layoutText,
  lineShape,
  styleText,
} from "./utils";

type ProcessVariant = "cards" | "timeline" | "path" | "steps";

function resolveVariant(ctx: LayoutGrammarContext): ProcessVariant {
  if (["cards", "timeline", "path", "steps"].includes(ctx.grammarVariant ?? "")) {
    return ctx.grammarVariant as ProcessVariant;
  }
  if (
    ctx.style.layoutTokens.shapeLanguage === "path"
    || ctx.style.layoutTokens.motif === "path-line"
  ) {
    return "path";
  }
  if (ctx.style.layoutTokens.shapeLanguage === "geometric") return "steps";
  if (ctx.style.chart.style === "report" || ctx.style.chart.style === "editorial") {
    return "timeline";
  }
  return "cards";
}

function applyCards(ctx: LayoutGrammarContext): void {
  const steps = ctx.bodyTexts;
  const count = Math.max(steps.length, 1);
  const spacing = layoutSpacing(ctx);
  const gap = spacing.gutter;
  const colW = (CONTENT.width - (count - 1) * gap) / count;
  const cardTop = CONTENT.y + spacing.compactPadding;
  const cardH = CONTENT.height - spacing.compactPadding * 2;
  const badgeSize = 32;

  // Connectors must be behind node cards.
  for (let index = 0; index < count - 1; index += 1) {
    const colX = CONTENT.x + index * (colW + gap);
    ctx.elements.push(ctx.helpers.createProcessArrow(
      colX + colW + 4,
      cardTop + cardH / 2 - 12,
      gap - 8,
      24,
    ));
  }

  steps.forEach((element, index) => {
    const colX = CONTENT.x + index * (colW + gap);
    ctx.elements.unshift(ctx.helpers.createCard(colX, cardTop, colW, cardH));
    ctx.elements.push(ctx.helpers.createAccentBar(
      colX + spacing.padding,
      cardTop + spacing.compactPadding,
      colW - spacing.padding * 2,
    ));
    const badgeX = colX + colW / 2 - badgeSize / 2;
    const badgeY = cardTop + spacing.padding + 12;
    ctx.elements.push(ctx.helpers.createStepBadge(badgeX, badgeY, badgeSize));
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1),
      x: badgeX,
      y: badgeY,
      width: badgeSize,
      height: badgeSize,
      role: "caption",
      baseSize: 16,
      minSize: 14,
      bold: true,
      color: ctx.colors.bg,
      align: "center",
      idPrefix: "num",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: colX + spacing.padding,
      y: badgeY + badgeSize + 10,
      width: colW - spacing.padding * 2,
      height: cardH - (badgeY - cardTop) - badgeSize - spacing.compactPadding - 10,
      role: "body",
      baseSize: 20,
      minSize: 14,
      color: ctx.colors.body,
      align: "center",
    }));
  });
}

function applyTimeline(ctx: LayoutGrammarContext): void {
  const steps = ctx.bodyTexts;
  const count = Math.max(steps.length, 1);
  const startX = 170;
  const endX = 1110;
  const lineY = 342;
  if (count > 1) ctx.elements.push(lineShape(ctx, startX, lineY, endX - startX, 4, 0.75));

  steps.forEach((element, index) => {
    const centerX = count === 1
      ? 640
      : startX + index * ((endX - startX) / (count - 1));
    const badgeSize = 38;
    ctx.elements.push(ctx.helpers.createStepBadge(centerX - badgeSize / 2, lineY - 17, badgeSize));
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1),
      x: centerX - badgeSize / 2,
      y: lineY - 17,
      width: badgeSize,
      height: badgeSize,
      role: "caption",
      baseSize: 16,
      bold: true,
      color: ctx.colors.bg,
      align: "center",
      idPrefix: "num",
    }));

    const above = index % 2 === 0;
    ctx.elements.push(styleText(ctx, element, {
      x: centerX - 115,
      y: above ? 220 : 390,
      width: 230,
      height: 105,
      role: index === 0 ? "kicker" : "body",
      baseSize: 19,
      minSize: 14,
      bold: index === 0,
      color: index === 0 ? ctx.colors.title : ctx.colors.body,
      align: "center",
    }));
  });
}

function applyPath(ctx: LayoutGrammarContext): void {
  const steps = ctx.bodyTexts;
  const count = Math.max(steps.length, 1);
  const spacing = layoutSpacing(ctx);
  const nodeW = Math.min(230, (CONTENT.width - 60) / Math.min(count, 4));
  const nodeH = 124;
  const available = CONTENT.width - nodeW;

  // Create path connectors first so they stay behind nodes.
  for (let index = 0; index < count - 1; index += 1) {
    const x = CONTENT.x + index * (available / Math.max(count - 1, 1));
    const nextX = CONTENT.x + (index + 1) * (available / Math.max(count - 1, 1));
    const y = index % 2 === 0 ? 294 : 446;
    ctx.elements.push(ctx.helpers.createProcessArrow(
      x + nodeW - 4,
      y,
      Math.max(12, nextX - x - nodeW + 8),
      22,
    ));
  }

  steps.forEach((element, index) => {
    const x = CONTENT.x + index * (available / Math.max(count - 1, 1));
    const y = index % 2 === 0 ? 220 : 372;
    ctx.elements.unshift(ctx.helpers.createCard(x, y, nodeW, nodeH));
    const inset = spacing.compactPadding;
    ctx.elements.push(ctx.helpers.createStepBadge(x + inset, y + inset, 30));
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1),
      x: x + inset,
      y: y + inset,
      width: 30,
      height: 30,
      role: "caption",
      baseSize: 14,
      bold: true,
      color: ctx.colors.bg,
      align: "center",
      idPrefix: "num",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: x + inset + 38,
      y: y + inset,
      width: nodeW - inset * 2 - 38,
      height: nodeH - inset * 2,
      role: index === 0 ? "kicker" : "body",
      baseSize: 18,
      minSize: 13,
      bold: index === 0,
      color: index === 0 ? ctx.colors.title : ctx.colors.body,
      align: "left",
    }));
  });
}

function applySteps(ctx: LayoutGrammarContext): void {
  const steps = ctx.bodyTexts;
  const count = Math.max(steps.length, 1);
  const spacing = layoutSpacing(ctx);
  const rowGap = Math.max(10, Math.round(spacing.gutter * 0.55));
  const rowH = Math.min(82, (CONTENT.height - rowGap * (count - 1)) / count);
  steps.forEach((element, index) => {
    const inset = index * Math.round(70 * spacing.scale);
    const x = CONTENT.x + inset;
    const y = CONTENT.y + index * (rowH + rowGap);
    const width = CONTENT.width - inset * 1.35;
    ctx.elements.unshift(ctx.helpers.createCard(x, y, width, rowH));
    ctx.elements.push(ctx.helpers.createAccentBlock(x, y, 54, rowH, { opacity: 0.9 }));
    ctx.elements.push(layoutText(ctx, {
      text: String(index + 1).padStart(2, "0"),
      x,
      y,
      width: 54,
      height: rowH,
      role: "caption",
      baseSize: 16,
      bold: true,
      color: ctx.colors.bg,
      align: "center",
      idPrefix: "num",
    }));
    ctx.elements.push(styleText(ctx, element, {
      x: x + 76,
      y: y + 8,
      width: width - 96,
      height: rowH - 16,
      role: index === 0 ? "kicker" : "body",
      baseSize: 20,
      minSize: 14,
      bold: index === 0,
      color: index === 0 ? ctx.colors.title : ctx.colors.body,
      align: "left",
    }));
  });
}

export const processGrammarHandler: LayoutGrammarHandler = {
  id: "process",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.process,
  defaultVariant: "cards",
  contentSlots: ["steps"],
  visualSlots: ["connectors", "nodes", "motif"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    if (variant === "timeline") applyTimeline(ctx);
    else if (variant === "path") applyPath(ctx);
    else if (variant === "steps") applySteps(ctx);
    else applyCards(ctx);
    return variant;
  },
};

layoutGrammarRegistry.register(processGrammarHandler);
