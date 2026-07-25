import type { LayoutGrammarContext, LayoutGrammarHandler } from "../layout-grammar";
import { layoutGrammarRegistry } from "../layout-grammar";
import { LAYOUT_GRAMMAR_VARIANTS } from "../layout-grammar-variants";
import { getImageGridSlotRect } from "../layout-slots";
import {
  CONTENT,
  applyImageTreatment,
  layoutSpacing,
  pickAnyImage,
  styleText,
} from "./utils";

type ImageGridVariant = "grid" | "hero-caption" | "filmstrip" | "evidence-wall";

function resolveVariant(ctx: LayoutGrammarContext): ImageGridVariant {
  if (["grid", "hero-caption", "filmstrip", "evidence-wall"].includes(ctx.grammarVariant ?? "")) {
    return ctx.grammarVariant as ImageGridVariant;
  }
  if (ctx.imageElements.length <= 1) return "hero-caption";
  if (ctx.style.layoutTokens.shapeLanguage === "editorial") return "filmstrip";
  if (ctx.style.layoutTokens.shapeLanguage === "annotation") return "evidence-wall";
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
  const spacing = layoutSpacing(ctx);
  const inset = Math.max(8, spacing.compactPadding);
  for (let index = 0; index < count; index += 1) {
    const slot = `grid-${index}`;
    const rect = getImageGridSlotRect(index, count);
    if (!rect) continue;
    ctx.elements.unshift(ctx.helpers.createCard(rect.x, rect.y, rect.width, rect.height));
    const image = ctx.helpers.pickImageForSlot(slot) ?? pickAnyImage(ctx);
    const caption = ctx.bodyTexts[index];
    if (image) {
      ctx.elements.push(place(ctx, image, {
        x: rect.x + inset,
        y: rect.y + inset,
        width: rect.width - inset * 2,
        height: rect.height - (caption ? inset * 2 + 32 : inset * 2),
      }, slot));
    }
    if (caption) {
      ctx.elements.push(styleText(ctx, caption, {
        x: rect.x + inset,
        y: rect.y + rect.height - inset - 30,
        width: rect.width - inset * 2,
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
  const spacing = layoutSpacing(ctx);
  const inset = spacing.compactPadding;
  ctx.elements.unshift(ctx.helpers.createCard(CONTENT.x, CONTENT.y, CONTENT.width, CONTENT.height));
  const extraCount = Math.max(0, ctx.imageElements.length - (hero ? 1 : 0));
  if (hero) {
    ctx.elements.push(place(ctx, hero, {
      x: CONTENT.x + inset,
      y: CONTENT.y + inset,
      width: extraCount > 0
        ? Math.round((CONTENT.width - inset * 3) * 0.7)
        : CONTENT.width - inset * 2,
      height: caption
        ? CONTENT.height - inset * 2 - 70
        : CONTENT.height - inset * 2,
    }, "hero"));
  }
  if (extraCount > 0) {
    const gap = Math.max(8, Math.round(spacing.gutter * 0.4));
    const supportCount = Math.min(extraCount, 3);
    const mediaHeight = CONTENT.height - inset * 2 - (caption ? 70 : 0);
    const supportH = (mediaHeight - gap * (supportCount - 1)) / supportCount;
    const supportX = CONTENT.x + Math.round((CONTENT.width - inset * 3) * 0.7) + inset * 2;
    for (let index = 0; index < supportCount; index += 1) {
      const support = pickAnyImage(ctx);
      if (!support) break;
      ctx.elements.push(place(ctx, support, {
        x: supportX,
        y: CONTENT.y + inset + index * (supportH + gap),
        width: CONTENT.x + CONTENT.width - inset - supportX,
        height: supportH,
      }, `grid-${index + 1}`));
    }
  }
  if (caption) {
    const extras = ctx.bodyTexts.slice(1).map((item) => item.text.trim()).filter(Boolean);
    if (extras.length > 0) caption.text = [caption.text.trim(), ...extras].join(" · ");
    ctx.elements.push(styleText(ctx, caption, {
      x: CONTENT.x + spacing.padding,
      y: CONTENT.y + CONTENT.height - inset - 48,
      width: CONTENT.width - spacing.padding * 2,
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
  const spacing = layoutSpacing(ctx);
  const gap = Math.max(14, Math.round(spacing.gutter * 0.7));
  const colW = (CONTENT.width - gap * (count - 1)) / count;
  const top = CONTENT.y + spacing.compactPadding;
  const cardH = CONTENT.height - spacing.compactPadding * 2;
  const imageH = cardH - spacing.padding * 2 - 58;
  for (let index = 0; index < count; index += 1) {
    const x = CONTENT.x + index * (colW + gap);
    const slot = `grid-${index}`;
    ctx.elements.unshift(ctx.helpers.createCard(x, top, colW, cardH));
    const image = ctx.helpers.pickImageForSlot(slot) ?? pickAnyImage(ctx);
    if (image) {
      ctx.elements.push(place(ctx, image, {
        x: x + spacing.compactPadding,
        y: top + spacing.compactPadding,
        width: colW - spacing.compactPadding * 2,
        height: imageH,
      }, slot));
    }
    const caption = ctx.bodyTexts[index];
    if (caption) {
      ctx.elements.push(styleText(ctx, caption, {
        x: x + spacing.compactPadding,
        y: top + spacing.compactPadding + imageH + 12,
        width: colW - spacing.compactPadding * 2,
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
  const spacing = layoutSpacing(ctx);
  const gap = spacing.gutter;
  const leftWidth = Math.round((CONTENT.width - gap) * 0.64);
  const left = { x: CONTENT.x, y: CONTENT.y, width: leftWidth, height: CONTENT.height };
  const right = {
    x: CONTENT.x + leftWidth + gap,
    y: CONTENT.y,
    width: CONTENT.width - leftWidth - gap,
    height: CONTENT.height,
  };
  const inset = spacing.compactPadding;
  const rightH = (right.height - gap) / 2;

  ctx.elements.unshift(ctx.helpers.createCard(left.x, left.y, left.width, left.height));
  if (primary) {
    ctx.elements.push(place(ctx, primary, {
      x: left.x + inset,
      y: left.y + inset,
      width: left.width - inset * 2,
      height: left.height - (primaryCaption ? inset * 2 + 36 : inset * 2),
    }, "grid-0"));
  }
  if (primaryCaption) {
    ctx.elements.push(styleText(ctx, primaryCaption, {
      x: left.x + inset,
      y: left.y + left.height - inset - 30,
      width: left.width - inset * 2,
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
        x: right.x + inset,
        y: y + inset,
        width: right.width - inset * 2,
        height: rightH - (caption ? inset * 2 + 30 : inset * 2),
      }, slot));
    }
    if (caption) {
      ctx.elements.push(styleText(ctx, caption, {
        x: right.x + inset,
        y: y + rightH - inset - 26,
        width: right.width - inset * 2,
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
