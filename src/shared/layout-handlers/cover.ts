import type { ImageElement, ShapeElement, TextElement } from "../presentation";
import {
  isDarkDesignTokens,
  resolveDesignTokenFontFamily,
} from "../design-tokens";
import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { createCoverMotif } from "../motif-system";
import { resolveCoverTitleFont } from "../typography";
import { VISUAL_TOKENS, cardShadow } from "../visual-tokens";

type CoverVariant = "centered" | "editorial-hero" | "signal-dark";

function resolveCoverVariant(ctx: LayoutGrammarContext): CoverVariant {
  if (ctx.grammarVariant === "centered") return "centered";
  if (ctx.grammarVariant === "editorial-hero" || ctx.grammarVariant === "signal-dark") {
    return ctx.grammarVariant;
  }
  if (!ctx.hasExplicitDesignTokens) return "centered";
  if (isDarkDesignTokens(ctx.designTokens)) return "signal-dark";
  if (
    ctx.designTokens.fontMood === "editorial" ||
    ctx.designTokens.motif === "bookmark" ||
    ctx.designTokens.shapeLanguage === "annotation"
  ) {
    return "editorial-hero";
  }
  return "centered";
}

function coverTitleFont(ctx: LayoutGrammarContext): "serif" | "sans" | "mono" {
  const fallback = resolveCoverTitleFont(ctx.theme);
  if (!ctx.hasExplicitDesignTokens) return fallback;
  return resolveDesignTokenFontFamily(ctx.designTokens, fallback);
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
  if (!ctx.hasExplicitDesignTokens) return image;
  const treatment = ctx.designTokens.imageTreatment;
  return {
    ...image,
    borderRadius:
      treatment === "masked"
        ? VISUAL_TOKENS.radii.lg
        : treatment === "framed" || treatment === "captioned"
          ? VISUAL_TOKENS.radii.md
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
    id: `motif-frame-${crypto.randomUUID()}`,
    type: "shape",
    shapeType: "roundedRect",
    x,
    y,
    width,
    height,
    fillColor: ctx.colors.cardBg,
    strokeColor: ctx.colors.cardStroke,
    cornerRadius: VISUAL_TOKENS.radii.md,
    shadow: cardShadow("md"),
    provenance: "layout",
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
  title.fontSize = 64;
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
    sub.fontSize = 24;
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
      motif: ctx.designTokens.motif,
      colors: ctx.colors,
      variant: "editorial-hero",
    }),
  );

  const heroImage = pickHeroImage(ctx);
  const hasHeroImage = Boolean(heroImage);
  const titleW = hasHeroImage ? 560 : 840;

  title.x = 150;
  title.y = 154;
  title.width = titleW;
  title.height = 188;
  title.fontSize = 58;
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
    sub.fontSize = 22;
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
        radius: VISUAL_TOKENS.radii.lg,
      }),
    );
  }
}

function applySignalDarkCover(ctx: LayoutGrammarContext): void {
  const { title, body } = titleAndBody(ctx);
  if (!title) return;

  ctx.elements.push(
    ...createCoverMotif({
      motif: ctx.designTokens.motif,
      colors: ctx.colors,
      variant: "signal-dark",
    }),
  );

  title.x = 118;
  title.y = 168;
  title.width = 700;
  title.height = 168;
  title.fontSize = 60;
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
    sub.fontSize = 22;
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
