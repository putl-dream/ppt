import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import {
  CONTENT,
  applyImageTreatment,
  pickAnyImage,
  styleText,
} from "./utils";

type CaseVariant = "split" | "metric-focus" | "evidence";

function resolveVariant(ctx: LayoutGrammarContext): CaseVariant {
  if (ctx.grammarVariant === "metric-focus" || ctx.grammarVariant === "evidence") {
    return ctx.grammarVariant;
  }
  if (ctx.grammarVariant === "split") return "split";
  if (!ctx.hasExplicitDesignTokens) return "split";
  const hasImage = ctx.imageElements.length > 0;
  if (hasImage && ctx.designTokens.imageTreatment !== "plain") return "evidence";
  if (ctx.designTokens.chartStyle === "dashboard" || ctx.designTokens.chartStyle === "report") {
    return "metric-focus";
  }
  return hasImage ? "evidence" : "split";
}

function foldText(ctx: LayoutGrammarContext, start: number): string[] {
  return ctx.bodyTexts.slice(start).map((item) => item.text.trim()).filter(Boolean);
}

function applySplit(ctx: LayoutGrammarContext): void {
  const description = ctx.bodyTexts[0];
  const metric = ctx.bodyTexts[1];
  const sideImage = pickAnyImage(ctx, "side");
  const left = { x: 120, y: CONTENT.y, width: 600, height: CONTENT.height };
  const right = { x: 760, y: CONTENT.y, width: 400, height: CONTENT.height };
  const pad = 24;

  ctx.elements.unshift(ctx.helpers.createCard(left.x, left.y, left.width, left.height));
  ctx.elements.unshift(ctx.helpers.createCard(right.x, right.y, right.width, right.height));
  ctx.elements.push(ctx.helpers.createAccentBlock(left.x + pad, left.y + pad, 6, 80, { opacity: 1 }));

  if (description) {
    const extras = foldText(ctx, sideImage ? 1 : 2);
    if (extras.length > 0) description.text = [description.text.trim(), ...extras].join("\n");
    ctx.elements.push(styleText(ctx, description, {
      x: left.x + 40,
      y: left.y + pad,
      width: left.width - 64,
      height: left.height - 48,
      role: "body",
      baseSize: 20,
      minSize: 14,
      color: ctx.colors.body,
      align: "left",
    }));
  }

  if (sideImage) {
    const placed = ctx.helpers.placeImageInSlot(sideImage, {
      x: right.x + pad,
      y: right.y + pad,
      width: right.width - pad * 2,
      height: right.height - pad * 2,
    }, "side");
    ctx.elements.push(applyImageTreatment(placed, ctx));
  } else if (metric) {
    ctx.elements.push(styleText(ctx, metric, {
      x: right.x + pad,
      y: right.y + 40,
      width: right.width - pad * 2,
      height: right.height - 80,
      role: "metric",
      baseSize: 32,
      minSize: 20,
      bold: true,
      color: ctx.colors.accent,
      align: "center",
    }));
  }
}

function applyMetricFocus(ctx: LayoutGrammarContext): void {
  const metric = ctx.bodyTexts[1] ?? ctx.bodyTexts[0];
  const description = ctx.bodyTexts[1] ? ctx.bodyTexts[0] : undefined;
  const left = { x: 120, y: CONTENT.y + 36, width: 430, height: 360 };
  const right = { x: 590, y: CONTENT.y, width: 570, height: CONTENT.height };

  ctx.elements.unshift(ctx.helpers.createCard(left.x, left.y, left.width, left.height));
  ctx.elements.unshift(ctx.helpers.createAccentBlock(right.x, right.y, right.width, right.height, { opacity: 0.12 }));
  ctx.elements.push(ctx.helpers.createAccentBar(left.x + 28, left.y + 28, 120));

  if (description) {
    const extras = foldText(ctx, 2);
    if (extras.length > 0) description.text = [description.text.trim(), ...extras].join("\n");
    ctx.elements.push(styleText(ctx, description, {
      x: left.x + 32,
      y: left.y + 64,
      width: left.width - 64,
      height: left.height - 92,
      role: "body",
      baseSize: 20,
      minSize: 14,
      color: ctx.colors.body,
      align: "left",
    }));
  }
  if (metric) {
    ctx.elements.push(styleText(ctx, metric, {
      x: right.x + 46,
      y: right.y + 72,
      width: right.width - 92,
      height: right.height - 144,
      role: "metric",
      baseSize: 58,
      minSize: 28,
      bold: true,
      color: ctx.colors.accent,
      align: "center",
    }));
  }
}

function applyEvidence(ctx: LayoutGrammarContext): void {
  const image = pickAnyImage(ctx, "side");
  if (!image) return applyMetricFocus(ctx);
  const description = ctx.bodyTexts[0];
  const metric = ctx.bodyTexts[1];
  const imageBox = { x: 120, y: CONTENT.y, width: 650, height: CONTENT.height };
  const textBox = { x: 810, y: CONTENT.y, width: 350, height: CONTENT.height };

  ctx.elements.unshift(ctx.helpers.createCard(imageBox.x, imageBox.y, imageBox.width, imageBox.height));
  const placed = ctx.helpers.placeImageInSlot(image, {
    x: imageBox.x + 16,
    y: imageBox.y + 16,
    width: imageBox.width - 32,
    height: imageBox.height - 32,
  }, "side");
  ctx.elements.push(applyImageTreatment(placed, ctx));
  ctx.elements.push(ctx.helpers.createAccentBlock(textBox.x, textBox.y, 8, textBox.height, { opacity: 1 }));

  if (metric) {
    ctx.elements.push(styleText(ctx, metric, {
      x: textBox.x + 34,
      y: textBox.y + 24,
      width: textBox.width - 46,
      height: 150,
      role: "metric",
      baseSize: 42,
      minSize: 24,
      bold: true,
      color: ctx.colors.accent,
      align: "left",
    }));
  }
  if (description) {
    const extras = foldText(ctx, 2);
    if (extras.length > 0) description.text = [description.text.trim(), ...extras].join("\n");
    ctx.elements.push(styleText(ctx, description, {
      x: textBox.x + 34,
      y: textBox.y + (metric ? 190 : 32),
      width: textBox.width - 46,
      height: textBox.height - (metric ? 214 : 64),
      role: "body",
      baseSize: 19,
      minSize: 14,
      color: ctx.colors.body,
      align: "left",
    }));
  }
}

export const caseGrammarHandler: LayoutGrammarHandler = {
  id: "case",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.case,
  defaultVariant: "split",
  contentSlots: ["narrative", "metric"],
  visualSlots: ["side", "evidence"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    if (variant === "metric-focus") applyMetricFocus(ctx);
    else if (variant === "evidence") applyEvidence(ctx);
    else applySplit(ctx);
    return variant;
  },
};

layoutGrammarRegistry.register(caseGrammarHandler);
