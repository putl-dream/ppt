import type { ImageElement, ShapeElement, TextElement } from "../presentation";
import {
  isDarkTokens,
} from "@design-system";
import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { createCoverMotif } from "../motif-system";

type CoverVariant = "centered" | "editorial-hero" | "signal-dark";

function resolveCoverVariant(ctx: LayoutGrammarContext): CoverVariant {
  if (ctx.grammarVariant === "centered") return "centered";
  if (ctx.grammarVariant === "editorial-hero" || ctx.grammarVariant === "signal-dark") {
    return ctx.grammarVariant;
  }
  if (isDarkTokens(ctx.style.layoutTokens)) return "signal-dark";
  if (
    ctx.style.layoutTokens.fontMood === "editorial" ||
    ctx.style.layoutTokens.motif === "bookmark" ||
    ctx.style.layoutTokens.shapeLanguage === "annotation"
  ) {
    return "editorial-hero";
  }
  return "centered";
}

function coverTitleFont(ctx: LayoutGrammarContext): "serif" | "sans" | "mono" {
  return ctx.style.typography.heading.family;
}

function titleAndBody(ctx: LayoutGrammarContext): {
  title?: TextElement;
  body: TextElement[];
} {
  const coverTitleEl = ctx.titleEl ?? ctx.bodyTexts[0];
  return {
    title: coverTitleEl,
    body: ctx.titleEl ? ctx.bodyTexts : ctx.bodyTexts.slice(1),
  };
}

function pickHeroImage(ctx: LayoutGrammarContext): ImageElement | undefined {
  return (
    ctx.helpers.pickImageForSlot("hero") ??
    (ctx.imageElements.length === 1 && !ctx.imageElements[0].imageSlot
      ? ctx.imageElements[0]
      : undefined)
  );
}

function applyImageTreatment(
  image: ImageElement,
  ctx: LayoutGrammarContext,
): ImageElement {
  const treatment = ctx.style.image.treatment;
  return {
    ...image,
    borderRadius:
      treatment === "masked"
        ? Math.max(0, ctx.style.shape.radius * 2)
        : treatment === "framed" || treatment === "captioned"
          ? Math.max(0, ctx.style.shape.radius)
          : image.borderRadius,
    imageTreatment: treatment,
  };
}

function createFrame(
  x: number,
  y: number,
  width: number,
  height: number,
  ctx: LayoutGrammarContext,
): ShapeElement {
  return {
    ...ctx.helpers.createCard(x, y, width, height),
    id: `motif-frame-${crypto.randomUUID()}`,
  };
}

function applyCenteredCover(ctx: LayoutGrammarContext): void {
  const { title, body } = titleAndBody(ctx);
  if (!title) return;

  ctx.elements.unshift(
    ctx.helpers.createAccentBlock(-60, 140, 180, 440, { opacity: 0.12 }),
  );

  title.x = 120;
  title.y = 180;
  title.width = 1040;
  title.height = 180;
  title.fontSize = Math.round(64 * ctx.style.typography.heading.scale);
  title.bold = true;
  title.color = ctx.colors.title;
  title.align = "center";
  title.fontFamily = coverTitleFont(ctx);
  ctx.elements.push(title);

  if (body[0]) {
    const sub = ctx.helpers.assignTextRole(body[0], "body");
    sub.x = 120;
    sub.y = 400;
    sub.width = 1040;
    sub.height = 80;
    sub.fontSize = Math.round(24 * ctx.style.typography.body.scale);
    sub.bold = false;
    sub.color = ctx.colors.body;
    sub.align = "center";
    ctx.elements.push(sub);
  }

  const heroImage = pickHeroImage(ctx);
  if (heroImage) {
    const placed = ctx.helpers.placeImageInSlot(
      heroImage,
      { x: 200, y: 500, width: 880, height: 160 },
      "hero",
    );
    ctx.elements.push(applyImageTreatment(placed, ctx));
  }
}

function applyEditorialCover(ctx: LayoutGrammarContext): void {
  const { title, body } = titleAndBody(ctx);
  if (!title) return;

  ctx.elements.push(
    ...createCoverMotif({
      motif: ctx.style.layoutTokens.motif,
      colors: ctx.colors,
      variant: "editorial-hero",
      style: ctx.style,
    }),
  );

  const heroImage = pickHeroImage(ctx);
  const hasHeroImage = Boolean(heroImage);
  const titleW = hasHeroImage ? 560 : 840;

  title.x = 150;
  title.y = 154;
  title.width = titleW;
  title.height = 188;
  title.fontSize = Math.round(58 * ctx.style.typography.heading.scale);
  title.bold = true;
  title.color = ctx.colors.title;
  title.align = "left";
  title.fontFamily = coverTitleFont(ctx);
  ctx.elements.push(title);

  if (body[0]) {
    const sub = ctx.helpers.assignTextRole(body[0], "body");
    sub.x = 154;
    sub.y = 378;
    sub.width = hasHeroImage ? 540 : 760;
    sub.height = 96;
    sub.fontSize = Math.round(22 * ctx.style.typography.body.scale);
    sub.bold = false;
    sub.color = ctx.colors.body;
    sub.align = "left";
    ctx.elements.push(sub);
  }

  if (heroImage) {
    const frame = createFrame(748, 132, 372, 432, ctx);
    ctx.elements.push(frame);
    const placed = ctx.helpers.placeImageInSlot(
      heroImage,
      { x: 768, y: 152, width: 332, height: 392 },
      "hero",
    );
    ctx.elements.push(applyImageTreatment(placed, ctx));
  } else {
    ctx.elements.push(
      ctx.helpers.createAccentBlock(760, 144, 300, 360, {
        opacity: 0.09,
        radius: ctx.style.shape.radius,
      }),
    );
  }
}

function applySignalDarkCover(ctx: LayoutGrammarContext): void {
  const { title, body } = titleAndBody(ctx);
  if (!title) return;

  ctx.elements.push(
    ...createCoverMotif({
      motif: ctx.style.layoutTokens.motif,
      colors: ctx.colors,
      variant: "signal-dark",
      style: ctx.style,
    }),
  );

  title.x = 118;
  title.y = 168;
  title.width = 700;
  title.height = 168;
  title.fontSize = Math.round(60 * ctx.style.typography.heading.scale);
  title.bold = true;
  title.color = ctx.colors.title;
  title.align = "left";
  title.fontFamily = coverTitleFont(ctx);
  ctx.elements.push(title);

  if (body[0]) {
    const sub = ctx.helpers.assignTextRole(body[0], "body");
    sub.x = 124;
    sub.y = 366;
    sub.width = 610;
    sub.height = 112;
    sub.fontSize = Math.round(22 * ctx.style.typography.body.scale);
    sub.bold = false;
    sub.color = ctx.colors.body;
    sub.align = "left";
    ctx.elements.push(sub);
  }

  const heroImage = pickHeroImage(ctx);
  if (heroImage) {
    const placed = ctx.helpers.placeImageInSlot(
      heroImage,
      { x: 836, y: 164, width: 284, height: 344 },
      "hero",
    );
    ctx.elements.push(applyImageTreatment(placed, ctx));
  }
}

export const coverGrammarHandler: LayoutGrammarHandler = {
  id: "cover",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS.cover,
  defaultVariant: "centered",
  contentSlots: ["title", "subtitle", "hero"],
  visualSlots: ["motif", "hero"],
  apply(ctx) {
    const variant = resolveCoverVariant(ctx);
    if (variant === "editorial-hero") {
      applyEditorialCover(ctx);
      return variant;
    }
    if (variant === "signal-dark") {
      applySignalDarkCover(ctx);
      return variant;
    }
    applyCenteredCover(ctx);
    return variant;
  },
};

layoutGrammarRegistry.register(coverGrammarHandler);
