import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import {
  CONTENT,
  applyImageTreatment,
  layoutSpacing,
  pickAnyImage,
  styleText,
} from "./utils";

type CaseVariant = "split" | "metric-focus" | "evidence";

function resolveVariant(ctx: LayoutGrammarContext): CaseVariant {
  if (ctx.grammarVariant === "metric-focus" || ctx.grammarVariant === "evidence") {
    return ctx.grammarVariant;
  }
  if (ctx.grammarVariant === "split") return "split";
  const hasImage = ctx.imageElements.length > 0;
  if (hasImage && ctx.style.image.treatment !== "plain") return "evidence";
  if (ctx.style.chart.style === "dashboard" || ctx.style.chart.style === "report") {
    return "metric-focus";
  }
  return hasImage ? "evidence" : "split";
}

function foldText(ctx: LayoutGrammarContext, start: number): string[] {
  return ctx.bodyTexts
    .filter((item) => item.textRole !== "caption" && item.textRole !== "metric")
    .slice(start)
    .map((item) => item.text.trim())
    .filter(Boolean);
}

function applySplit(ctx: LayoutGrammarContext): void {
  const source = ctx.bodyTexts.find((item) => item.textRole === "caption");
  const explicitMetric = ctx.bodyTexts.find((item) => item.textRole === "metric");
  const narratives = ctx.bodyTexts.filter(
    (item) => item.textRole !== "caption" && item.textRole !== "metric",
  );
  const description = narratives[0];
  const metric = explicitMetric ?? narratives[1];
  const chart = ctx.dataElements.find((element) => element.type === "chart");
  const sideImage = pickAnyImage(ctx, "side");
  const spacing = layoutSpacing(ctx);
  const gap = spacing.gutter;
  const leftWidth = Math.round((CONTENT.width - gap) * 0.6);
  const left = { x: CONTENT.x, y: CONTENT.y, width: leftWidth, height: CONTENT.height };
  const right = {
    x: CONTENT.x + leftWidth + gap,
    y: CONTENT.y,
    width: CONTENT.width - leftWidth - gap,
    height: CONTENT.height,
  };
  const pad = spacing.padding;

  ctx.elements.unshift(ctx.helpers.createCard(left.x, left.y, left.width, left.height));
  if (sideImage || metric || chart) {
    ctx.elements.unshift(ctx.helpers.createCard(right.x, right.y, right.width, right.height));
  }
  ctx.elements.push(ctx.helpers.createAccentBlock(left.x + pad, left.y + pad, 6, 80, { opacity: 1 }));

  if (description) {
    const extras = foldText(ctx, metric && metric !== explicitMetric ? 2 : 1);
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

  if (chart) {
    ctx.elements.push(ctx.helpers.placeDataInSlot(chart, {
      x: right.x + 20,
      y: right.y + 28,
      width: right.width - 40,
      height: right.height - 56,
    }));
  } else if (sideImage) {
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
  if (source) {
    ctx.elements.push(styleText(ctx, source, {
      x: 120,
      y: 650,
      width: 1040,
      height: 28,
      role: "caption",
      baseSize: 14,
      minSize: 11,
      color: ctx.colors.body,
      align: "left",
    }));
  }
}

function applyMetricFocus(ctx: LayoutGrammarContext): void {
  const source = ctx.bodyTexts.find((item) => item.textRole === "caption");
  const narratives = ctx.bodyTexts.filter(
    (item) => item.textRole !== "caption" && item.textRole !== "metric",
  );
  const metric = ctx.bodyTexts.find((item) => item.textRole === "metric")
    ?? narratives[1]
    ?? narratives[0];
  const description = narratives.find((item) => item.id !== metric?.id);
  const spacing = layoutSpacing(ctx);
  const gap = spacing.gutter;
  const leftWidth = Math.round((CONTENT.width - gap) * 0.42);
  const left = {
    x: CONTENT.x,
    y: CONTENT.y + spacing.compactPadding,
    width: leftWidth,
    height: CONTENT.height - spacing.compactPadding * 2,
  };
  const right = {
    x: CONTENT.x + leftWidth + gap,
    y: CONTENT.y,
    width: CONTENT.width - leftWidth - gap,
    height: CONTENT.height,
  };

  ctx.elements.unshift(ctx.helpers.createCard(left.x, left.y, left.width, left.height));
  ctx.elements.unshift(ctx.helpers.createAccentBlock(right.x, right.y, right.width, right.height, { opacity: 0.12 }));
  ctx.elements.push(ctx.helpers.createAccentBar(
    left.x + spacing.padding,
    left.y + spacing.padding,
    120,
  ));

  if (description) {
    const extras = narratives
      .filter((item) => item.id !== description.id && item.id !== metric?.id)
      .map((item) => item.text.trim())
      .filter(Boolean);
    if (extras.length > 0) description.text = [description.text.trim(), ...extras].join("\n");
    ctx.elements.push(styleText(ctx, description, {
      x: left.x + spacing.padding,
      y: left.y + spacing.padding + 36,
      width: left.width - spacing.padding * 2,
      height: left.height - spacing.padding * 2 - 36,
      role: "body",
      baseSize: 20,
      minSize: 14,
      color: ctx.colors.body,
      align: "left",
    }));
  }
  if (metric) {
    ctx.elements.push(styleText(ctx, metric, {
      x: right.x + spacing.padding,
      y: right.y + spacing.padding * 2,
      width: right.width - spacing.padding * 2,
      height: right.height - spacing.padding * 4,
      role: "metric",
      baseSize: 58,
      minSize: 28,
      bold: true,
      color: ctx.colors.accent,
      align: "center",
    }));
  }
  if (source) {
    ctx.elements.push(styleText(ctx, source, {
      x: 120,
      y: 650,
      width: 1040,
      height: 28,
      role: "caption",
      baseSize: 14,
      minSize: 11,
      color: ctx.colors.body,
      align: "left",
    }));
  }
}

function applyEvidence(ctx: LayoutGrammarContext): void {
  const image = pickAnyImage(ctx, "side");
  if (!image) return applyMetricFocus(ctx);
  const source = ctx.bodyTexts.find((item) => item.textRole === "caption");
  const narratives = ctx.bodyTexts.filter(
    (item) => item.textRole !== "caption" && item.textRole !== "metric",
  );
  const metric = ctx.bodyTexts.find((item) => item.textRole === "metric") ?? narratives[1];
  const description = narratives[0];
  const spacing = layoutSpacing(ctx);
  const gap = spacing.gutter;
  const imageWidth = Math.round((CONTENT.width - gap) * 0.65);
  const imageBox = {
    x: CONTENT.x,
    y: CONTENT.y,
    width: imageWidth,
    height: CONTENT.height,
  };
  const textBox = {
    x: CONTENT.x + imageWidth + gap,
    y: CONTENT.y,
    width: CONTENT.width - imageWidth - gap,
    height: CONTENT.height,
  };

  ctx.elements.unshift(ctx.helpers.createCard(imageBox.x, imageBox.y, imageBox.width, imageBox.height));
  const placed = ctx.helpers.placeImageInSlot(image, {
    x: imageBox.x + spacing.compactPadding,
    y: imageBox.y + spacing.compactPadding,
    width: imageBox.width - spacing.compactPadding * 2,
    height: imageBox.height - spacing.compactPadding * 2,
  }, "side");
  ctx.elements.push(applyImageTreatment(placed, ctx));
  ctx.elements.push(ctx.helpers.createAccentBlock(textBox.x, textBox.y, 8, textBox.height, { opacity: 1 }));

  if (metric) {
    ctx.elements.push(styleText(ctx, metric, {
      x: textBox.x + spacing.padding,
      y: textBox.y + spacing.compactPadding,
      width: textBox.width - spacing.padding,
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
    const extras = narratives
      .filter((item) => item.id !== description.id && item.id !== metric?.id)
      .map((item) => item.text.trim())
      .filter(Boolean);
    if (extras.length > 0) description.text = [description.text.trim(), ...extras].join("\n");
    ctx.elements.push(styleText(ctx, description, {
      x: textBox.x + spacing.padding,
      y: textBox.y + (metric ? 190 : spacing.padding),
      width: textBox.width - spacing.padding,
      height: textBox.height - (metric ? 190 + spacing.padding : spacing.padding * 2),
      role: "body",
      baseSize: 19,
      minSize: 14,
      color: ctx.colors.body,
      align: "left",
    }));
  }
  if (source) {
    ctx.elements.push(styleText(ctx, source, {
      x: 120,
      y: 650,
      width: 1040,
      height: 28,
      role: "caption",
      baseSize: 14,
      minSize: 11,
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
