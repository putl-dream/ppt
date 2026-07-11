import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { getImageGridSlotRect } from "../layout-slots";
import {
  CONTENT,
  applyImageTreatment,
  pickAnyImage,
  styleText,
} from "./utils";

type ImageGridVariant = "grid" | "hero-caption" | "filmstrip" | "evidence-wall";

function resolveVariant(ctx: LayoutGrammarContext): ImageGridVariant {
  if (["grid", "hero-caption", "filmstrip", "evidence-wall"].includes(ctx.grammarVariant ?? "")) {
    return ctx.grammarVariant as ImageGridVariant;
  }
  if (!ctx.hasExplicitDesignTokens) return "grid";
  if (ctx.imageElements.length <= 1) return "hero-caption";
  if (ctx.designTokens.shapeLanguage === "editorial") return "filmstrip";
  if (ctx.designTokens.shapeLanguage === "annotation") return "evidence-wall";
  return "grid";
}

function place(
  ctx: LayoutGrammarContext,
  image: NonNullable<ReturnType<typeof pickAnyImage>>,
  rect: { x: number; y: number; width: number; height: number },
  slot: string,
) {
  return applyImageTreatment(ctx.helpers.placeImageInSlot(image, rect, slot), ctx);
}

function applyGrid(ctx: LayoutGrammarContext): void {
  const count = Math.min(Math.max(ctx.imageElements.length, ctx.bodyTexts.length, 1), 4);
  for (let index = 0; index < count; index += 1) {
    const slot = `grid-${index}`;
    const rect = getImageGridSlotRect(index, count);
    if (!rect) continue;
    ctx.elements.unshift(ctx.helpers.createCard(rect.x, rect.y, rect.width, rect.height));
    const image = ctx.helpers.pickImageForSlot(slot) ?? pickAnyImage(ctx);
    const caption = ctx.bodyTexts[index];
    if (image) {
      ctx.elements.push(place(ctx, image, {
        x: rect.x + 12,
        y: rect.y + 12,
        width: rect.width - 24,
        height: rect.height - (caption ? 56 : 24),
      }, slot));
    }
    if (caption) {
      ctx.elements.push(styleText(ctx, caption, {
        x: rect.x + 14,
        y: rect.y + rect.height - 42,
        width: rect.width - 28,
        height: 30,
        role: "caption",
        baseSize: 16,
        minSize: 12,
        color: ctx.colors.body,
        align: "center",
      }));
    }
  }
}

function applyHeroCaption(ctx: LayoutGrammarContext): void {
  const hero = ctx.helpers.pickImageForSlot("hero") ?? pickAnyImage(ctx);
  const caption = ctx.bodyTexts[0];
  ctx.elements.unshift(ctx.helpers.createCard(CONTENT.x, CONTENT.y, CONTENT.width, CONTENT.height));
  const extraCount = Math.max(0, ctx.imageElements.length - (hero ? 1 : 0));
  if (hero) {
    ctx.elements.push(place(ctx, hero, {
      x: CONTENT.x + 14,
      y: CONTENT.y + 14,
      width: extraCount > 0 ? 710 : CONTENT.width - 28,
      height: caption ? 350 : CONTENT.height - 28,
    }, "hero"));
  }
  if (extraCount > 0) {
    const gap = 12;
    const supportCount = Math.min(extraCount, 3);
    const supportH = (350 - gap * (supportCount - 1)) / supportCount;
    for (let index = 0; index < supportCount; index += 1) {
      const support = pickAnyImage(ctx);
      if (!support) break;
      ctx.elements.push(place(ctx, support, {
        x: 868,
        y: CONTENT.y + 14 + index * (supportH + gap),
        width: 278,
        height: supportH,
      }, `grid-${index + 1}`));
    }
  }
  if (caption) {
    const extras = ctx.bodyTexts.slice(1).map((item) => item.text.trim()).filter(Boolean);
    if (extras.length > 0) caption.text = [caption.text.trim(), ...extras].join(" · ");
    ctx.elements.push(styleText(ctx, caption, {
      x: CONTENT.x + 38,
      y: CONTENT.y + 382,
      width: CONTENT.width - 76,
      height: 42,
      role: "caption",
      baseSize: 18,
      minSize: 14,
      color: ctx.colors.body,
      align: "left",
    }));
  }
}

function applyFilmstrip(ctx: LayoutGrammarContext): void {
  const count = Math.min(Math.max(ctx.imageElements.length, ctx.bodyTexts.length, 1), 4);
  const gap = 22;
  const colW = (CONTENT.width - gap * (count - 1)) / count;
  const top = CONTENT.y + 34;
  const imageH = 270;
  for (let index = 0; index < count; index += 1) {
    const x = CONTENT.x + index * (colW + gap);
    const slot = `grid-${index}`;
    ctx.elements.unshift(ctx.helpers.createCard(x, top, colW, 360));
    const image = ctx.helpers.pickImageForSlot(slot) ?? pickAnyImage(ctx);
    if (image) {
      ctx.elements.push(place(ctx, image, {
        x: x + 12,
        y: top + 12,
        width: colW - 24,
        height: imageH,
      }, slot));
    }
    const caption = ctx.bodyTexts[index];
    if (caption) {
      ctx.elements.push(styleText(ctx, caption, {
        x: x + 16,
        y: top + imageH + 24,
        width: colW - 32,
        height: 58,
        role: "caption",
        baseSize: 16,
        minSize: 12,
        color: ctx.colors.body,
        align: "left",
      }));
    }
  }
}

function applyEvidenceWall(ctx: LayoutGrammarContext): void {
  const primary = ctx.helpers.pickImageForSlot("grid-0") ?? pickAnyImage(ctx);
  const primaryCaption = ctx.bodyTexts[0];
  const left = { x: CONTENT.x, y: CONTENT.y, width: 650, height: CONTENT.height };
  const right = { x: 800, y: CONTENT.y, width: 360, height: CONTENT.height };
  const gap = 18;
  const rightH = (right.height - gap) / 2;

  ctx.elements.unshift(ctx.helpers.createCard(left.x, left.y, left.width, left.height));
  if (primary) {
    ctx.elements.push(place(ctx, primary, {
      x: left.x + 12,
      y: left.y + 12,
      width: left.width - 24,
      height: left.height - (primaryCaption ? 60 : 24),
    }, "grid-0"));
  }
  if (primaryCaption) {
    ctx.elements.push(styleText(ctx, primaryCaption, {
      x: left.x + 18,
      y: left.y + left.height - 44,
      width: left.width - 36,
      height: 30,
      role: "caption",
      baseSize: 16,
      minSize: 12,
      color: ctx.colors.body,
      align: "left",
    }));
  }

  for (let index = 0; index < 2; index += 1) {
    const y = right.y + index * (rightH + gap);
    const slot = `grid-${index + 1}`;
    const caption = ctx.bodyTexts[index + 1];
    ctx.elements.unshift(ctx.helpers.createCard(right.x, y, right.width, rightH));
    const image = ctx.helpers.pickImageForSlot(slot) ?? pickAnyImage(ctx);
    if (image) {
      ctx.elements.push(place(ctx, image, {
        x: right.x + 10,
        y: y + 10,
        width: right.width - 20,
        height: rightH - (caption ? 50 : 20),
      }, slot));
    }
    if (caption) {
      ctx.elements.push(styleText(ctx, caption, {
        x: right.x + 14,
        y: y + rightH - 36,
        width: right.width - 28,
        height: 26,
        role: "caption",
        baseSize: 14,
        minSize: 11,
        color: ctx.colors.body,
        align: "left",
      }));
    }
  }
}

export const imageGridGrammarHandler: LayoutGrammarHandler = {
  id: "image-grid",
  supportedVariants: LAYOUT_GRAMMAR_VARIANTS["image-grid"],
  defaultVariant: "grid",
  contentSlots: ["captions"],
  visualSlots: ["hero", "grid-0", "grid-1", "grid-2", "grid-3"],
  apply(ctx) {
    const variant = resolveVariant(ctx);
    if (variant === "hero-caption") applyHeroCaption(ctx);
    else if (variant === "filmstrip") applyFilmstrip(ctx);
    else if (variant === "evidence-wall") applyEvidenceWall(ctx);
    else applyGrid(ctx);
    return variant;
  },
};

layoutGrammarRegistry.register(imageGridGrammarHandler);
