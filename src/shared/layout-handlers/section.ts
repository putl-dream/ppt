import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import {
  CONTENT,
  applyImageTreatment,
  pickAnyImage,
  styleText,
} from "./utils";

type SectionVariant = "centered" | "editorial-split" | "band";

function resolveVariant(ctx: LayoutGrammarContext): SectionVariant {
  if (ctx.grammarVariant === "editorial-split" || ctx.grammarVariant === "band") {
    return ctx.grammarVariant;
  }
  if (ctx.grammarVariant === "centered") return "centered";
  if (
    ctx.style.tokens.shapeLanguage === "editorial"
    || ctx.style.tokens.shapeLanguage === "annotation"
    || ctx.style.tokens.motif === "bookmark"
  ) {
    return "editorial-split";
  }
  if (
    ctx.style.tokens.shapeLanguage === "geometric"
    || ctx.style.tokens.backgroundStyle === "dark"
  ) {
    return "band";
  }
  return "centered";
}

function titleAndBody(ctx: LayoutGrammarContext) {
  const title = ctx.titleEl ?? ctx.bodyTexts[0];
  const body = ctx.titleEl ? ctx.bodyTexts : ctx.bodyTexts.slice(1);
  return { title, body };
}

function applyCentered(ctx: LayoutGrammarContext): void {
  const { title, body } = titleAndBody(ctx);
  if (!title) return;
  ctx.elements.push(ctx.helpers.createAccentBlock(520, 100, 240, 8, { opacity: 0.45 }));
  ctx.elements.push(styleText(ctx, title, {
    x: 120,
    y: 220,
    width: 1040,
    height: 140,
    role: "kicker",
    baseSize: 52,
    minSize: 38,
    bold: true,
    color: ctx.colors.title,
    align: "center",
  }));
  if (body[0]) {
    ctx.elements.push(styleText(ctx, body[0], {
      x: 200,
      y: 390,
      width: 880,
      height: 100,
      role: "body",
      baseSize: 22,
      minSize: 16,
      color: ctx.colors.body,
      align: "center",
    }));
  }
}

function applyEditorialSplit(ctx: LayoutGrammarContext): void {
  const { title, body } = titleAndBody(ctx);
  if (!title) return;
  const hero = pickAnyImage(ctx, "hero");

  ctx.elements.push(ctx.helpers.createAccentBlock(104, 150, 14, 410, { opacity: 1 }));
  ctx.elements.push(styleText(ctx, title, {
    x: 150,
    y: 205,
    width: hero ? 560 : 760,
    height: 165,
    role: "kicker",
    baseSize: 54,
    minSize: 38,
    bold: true,
    color: ctx.colors.title,
    align: "left",
  }));
  if (body[0]) {
    ctx.elements.push(styleText(ctx, body[0], {
      x: 154,
      y: 395,
      width: hero ? 530 : 720,
      height: 108,
      role: "body",
      baseSize: 22,
      minSize: 16,
      color: ctx.colors.body,
      align: "left",
    }));
  }

  if (hero) {
    ctx.elements.unshift(ctx.helpers.createCard(760, 136, 380, 436));
    const placed = ctx.helpers.placeImageInSlot(
      hero,
      { x: 780, y: 156, width: 340, height: 396 },
      "hero",
    );
    ctx.elements.push(applyImageTreatment(placed, ctx));
  } else {
    ctx.elements.push(ctx.helpers.createAccentBlock(860, 190, 260, 260, { opacity: 0.12 }));
    ctx.elements.push(ctx.helpers.createAccentBlock(930, 260, 120, 120, { opacity: 0.22 }));
  }
}

function applyBand(ctx: LayoutGrammarContext): void {
  const { title, body } = titleAndBody(ctx);
  if (!title) return;
  ctx.elements.unshift(ctx.helpers.createAccentBlock(80, 180, 1120, 270, { opacity: 0.16 }));
  ctx.elements.push(ctx.helpers.createAccentBlock(120, 210, 84, 8, { opacity: 1 }));
  ctx.elements.push(styleText(ctx, title, {
    x: 140,
    y: 240,
    width: 1000,
    height: 130,
    role: "kicker",
    baseSize: 56,
    minSize: 40,
    bold: true,
    color: ctx.colors.title,
    align: "left",
  }));
  if (body[0]) {
    ctx.elements.push(styleText(ctx, body[0], {
      x: CONTENT.x + 20,
      y: 475,
      width: CONTENT.width - 40,
      height: 72,
      role: "body",
      baseSize: 20,
      minSize: 16,
      color: ctx.colors.body,
      align: "right",
    }));
  }
}

export const sectionGrammarHandler: LayoutGrammarHandler = {
  id: "section",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.section,
  defaultVariant: "centered",
  contentSlots: ["title", "subtitle"],
  visualSlots: ["hero", "motif"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    if (variant === "editorial-split") applyEditorialSplit(ctx);
    else if (variant === "band") applyBand(ctx);
    else applyCentered(ctx);
    return variant;
  },
};

layoutGrammarRegistry.register(sectionGrammarHandler);
