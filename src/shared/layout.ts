import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement } from "./presentation";
import { getImageGridSlotRect } from "./layout-slots";
import type { SlideLayoutType } from "./slide-layouts";
import type { ResolvedSlideStyle, SlideDesignOverride } from "@design-system";
import {
  resolveFontFamily,
  type TextRole,
} from "./typography";
import { resolveLayoutBackgroundVariant, type BackgroundVariant } from "./slide-background";
import { cardShadow, VISUAL_TOKENS } from "./visual-tokens";
import { isUserPreservedShape } from "./layout-shape-utils";
import "./layout-register-builtin";
import "./layout-handlers/cover";
import "./layout-handlers/section";
import "./layout-handlers/process";
import "./layout-handlers/case";
import "./layout-handlers/image-grid";
import { layoutRegistry } from "./layout-registry";
import { layoutGrammarRegistry } from "./layout-grammar";
import { fitFontSize } from "./layout-text-fit";

export { estimateTextWidthUnits, fitFontSize } from "./layout-text-fit";

const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15);
};

/** Body layout region below slide chrome (1280×720 canvas). P1-1 spacing tune. */
const CANVAS_CONTENT_X = 120;
const CANVAS_CONTENT_W = 1040;
const BODY_CONTENT_Y = 188;
const BODY_CONTENT_H = 448;
const CARD_GAP = 32;
const CARD_PAD = 28;
const CARD_PAD_SM = 24;
const ROW_GAP = 24;
const MIN_STACK_ROW_HEIGHT = 24;
const MIN_STACK_CONTENT_HEIGHT = 16;

function resolveVerticalStackMetrics(
  itemCount: number,
  availableHeight: number,
  preferredGap: number,
  preferredInset: number,
): { gap: number; rowHeight: number; inset: number } {
  const count = Math.max(1, itemCount);
  const maxAffordableGap = count === 1
    ? 0
    : (availableHeight - count * MIN_STACK_ROW_HEIGHT) / (count - 1);
  const gap = count === 1
    ? 0
    : Math.min(preferredGap, Math.max(0, maxAffordableGap));
  const rowHeight = Math.max(1, (availableHeight - (count - 1) * gap) / count);
  const inset = Math.min(
    preferredInset,
    Math.max(0, (rowHeight - MIN_STACK_CONTENT_HEIGHT) / 2),
  );
  return { gap, rowHeight, inset };
}

export function applyLayout(
  slide: Slide,
  layout: SlideLayoutType,
  style: ResolvedSlideStyle,
  options: {
    grammarVariant?: string;
    designOverride?: SlideDesignOverride;
  } = {},
): Slide {
  const workingSlide = structuredClone(slide);
  const colors = style.colors;
  const grammarVariant = options.grammarVariant ?? slide.grammarVariant;

  // Separate elements by type
  let textElements = workingSlide.elements.filter((el): el is TextElement => el.type === "text");
  const imageElements = workingSlide.elements.filter((el) => el.type === "image");
  
  // Keep user-added shapes (lines, circles, arrows) — not layout-generated cards/badges.
  const userShapes = workingSlide.elements.filter(isUserPreservedShape);

  if (textElements.length === 0 && layout !== "image-grid") {
    return slide;
  }

  const isChromeLayout = layout === "cover" || layout === "section";
  const normalizedTitle = workingSlide.title.trim();

  // Drop canvas text that duplicates the chrome header title on content slides.
  if (!isChromeLayout) {
    textElements = textElements.filter(
      (el) => el.text.trim() !== normalizedTitle && el.fontSize < 36,
    );
  }

  const titleEl = isChromeLayout && textElements.length > 0
    ? textElements.find(
        (el) => el.text.trim() === normalizedTitle || el.fontSize >= 36,
      )
    : undefined;

  const bodyTexts = titleEl
    ? textElements.filter((el) => el.id !== titleEl.id)
    : textElements;
  const elements: SlideElement[] = [];

  const createCard = (x: number, y: number, w: number, h: number): ShapeElement => ({
    id: `card-${generateId()}`,
    type: "shape",
    shapeType: "roundedRect",
    x,
    y,
    width: w,
    height: h,
    fillColor: colors.cardBg,
    strokeColor: colors.cardStroke,
    cornerRadius: VISUAL_TOKENS.radii.md,
    shadow: cardShadow("md"),
    provenance: "layout",
  });

  const createAccentBlock = (
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { opacity?: number; radius?: number } = {},
  ): ShapeElement => ({
    id: `accent-${generateId()}`,
    type: "shape",
    shapeType: "roundedRect",
    x,
    y,
    width: w,
    height: h,
    fillColor: colors.accent,
    strokeColor: colors.accent,
    cornerRadius: opts.radius ?? VISUAL_TOKENS.radii.lg,
    fillOpacity: opts.opacity ?? 0.15,
    shadow: cardShadow("sm"),
    provenance: "layout",
  });

  const createAccentBar = (x: number, y: number, w: number): ShapeElement =>
    createAccentBlock(x, y, w, 6, { opacity: 1, radius: VISUAL_TOKENS.radii.pill });

  const createStepBadge = (x: number, y: number, size: number): ShapeElement => ({
    id: `badge-${generateId()}`,
    type: "shape",
    shapeType: "circle",
    x,
    y,
    width: size,
    height: size,
    fillColor: colors.accent,
    strokeColor: colors.accent,
    shadow: cardShadow("sm"),
    provenance: "layout",
  });

  const createProcessArrow = (x: number, y: number, w: number, h: number): ShapeElement => ({
    id: `arrow-${generateId()}`,
    type: "shape",
    shapeType: "arrow",
    x,
    y,
    width: w,
    height: h,
    fillColor: colors.accent,
    strokeColor: colors.accent,
    provenance: "layout",
  });

  const placedImageIds = new Set<string>();

  const assignTextRole = (el: TextElement, role: TextRole): TextElement => ({
    ...el,
    textRole: role,
    fontFamily: resolveFontFamily(el.fontFamily, role, style.typography.family),
  });

  const placeImageInSlot = (
    image: ImageElement,
    rect: { x: number; y: number; width: number; height: number },
    slotName: string,
  ): ImageElement => {
    placedImageIds.add(image.id);
    return {
      ...image,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      imageSlot: slotName,
      objectFit: image.objectFit ?? "cover",
    };
  };

  const pickImageForSlot = (
    slotName: string,
    fallbackUnslottedOnly = false,
  ): ImageElement | undefined => {
    const slotted = imageElements.find((img) => img.imageSlot === slotName);
    if (slotted) return slotted;
    if (fallbackUnslottedOnly) {
      return imageElements.find((img) => !img.imageSlot && !placedImageIds.has(img.id));
    }
    return undefined;
  };

  const grammarHandler = layoutGrammarRegistry.get(layout);
  let appliedGrammarVariant = grammarVariant;
  if (grammarHandler) {
    appliedGrammarVariant = grammarHandler.apply({
      slide: workingSlide,
      style,
      colors,
      textElements,
      imageElements,
      userShapes,
      titleEl,
      bodyTexts,
      elements,
      placedImageIds,
      helpers: {
        createCard,
        createAccentBlock,
        createAccentBar,
        createStepBadge,
        createProcessArrow,
        assignTextRole,
        placeImageInSlot,
        pickImageForSlot,
      },
      grammarVariant,
    }) ?? grammarVariant ?? grammarHandler.defaultVariant;
  } else if (layout === "cover" || layout === "section") {
    const coverTitleEl = titleEl ?? bodyTexts[0];
    if (!coverTitleEl) {
      return slide;
    }
    const coverBodyTexts = titleEl ? bodyTexts : bodyTexts.slice(1);

    if (layout === "cover") {
      elements.unshift(createAccentBlock(-60, 140, 180, 440, { opacity: 0.12 }));

      coverTitleEl.x = 120;
      coverTitleEl.y = 180;
      coverTitleEl.width = 1040;
      coverTitleEl.height = 180;
      coverTitleEl.fontSize = 64;
      coverTitleEl.bold = true;
      coverTitleEl.color = colors.title;
      coverTitleEl.align = "center";
      coverTitleEl.fontFamily = style.typography.family;
      elements.push(coverTitleEl);

      if (coverBodyTexts[0]) {
        const sub = assignTextRole(coverBodyTexts[0], "body");
        sub.x = 120;
        sub.y = 400;
        sub.width = 1040;
        sub.height = 80;
        sub.fontSize = 24;
        sub.bold = false;
        sub.color = colors.body;
        sub.align = "center";
        elements.push(sub);
      }

      const heroImage =
        pickImageForSlot("hero") ??
        (imageElements.length === 1 && !imageElements[0].imageSlot
          ? imageElements[0]
          : undefined);
      if (heroImage) {
        elements.push(
          placeImageInSlot(
            heroImage,
            { x: 200, y: 500, width: 880, height: 160 },
            "hero",
          ),
        );
      }
    } else {
      elements.unshift(createAccentBlock(520, 60, 240, 8, { opacity: 0.35, radius: VISUAL_TOKENS.radii.pill }));

      coverTitleEl.x = 120;
      coverTitleEl.y = 220;
      coverTitleEl.width = 1040;
      coverTitleEl.height = 140;
      coverTitleEl.fontSize = 52;
      coverTitleEl.bold = true;
      coverTitleEl.color = colors.title;
      coverTitleEl.align = "center";
      coverTitleEl.fontFamily = style.typography.family;
      elements.push(coverTitleEl);

      if (coverBodyTexts[0]) {
        const sub = assignTextRole(coverBodyTexts[0], "kicker");
        sub.x = 120;
        sub.y = 400;
        sub.width = 1040;
        sub.height = 120;
        sub.fontSize = 22;
        sub.bold = false;
        sub.color = colors.body;
        sub.align = "center";
        elements.push(sub);
      }
    }
  } else {
    // slide.title is rendered in chrome (Canvas / PPTMirror / export header).
    // Only body elements belong on the canvas here.
    const contentY = BODY_CONTENT_Y;
    const contentH = BODY_CONTENT_H;

    if (layout === "comparison") {
      const leftCols: TextElement[] = [];
      const rightCols: TextElement[] = [];
      bodyTexts.forEach((el, idx) => {
        if (idx % 2 === 0) leftCols.push(el);
        else rightCols.push(el);
      });

      const colW = 480;
      const leftX = CANVAS_CONTENT_X;
      const rightX = 680;

      elements.unshift(createCard(leftX, contentY, colW, contentH));
      elements.unshift(createCard(rightX, contentY, colW, contentH));
      elements.push(createAccentBlock(leftX + CARD_PAD_SM, contentY + CARD_PAD_SM, 48, 48, { opacity: 1, radius: VISUAL_TOKENS.radii.md }));
      elements.push(createAccentBlock(rightX + CARD_PAD_SM, contentY + CARD_PAD_SM, 48, 48, { opacity: 1, radius: VISUAL_TOKENS.radii.md }));

      const accentHeaderH = 56;

      if (leftCols.length > 0) {
        const textH = contentH - CARD_PAD * 2 - accentHeaderH;
        const textItemH = textH / leftCols.length;
        leftCols.forEach((el, idx) => {
          const styled = assignTextRole(el, idx === 0 ? "kicker" : "body");
          styled.x = leftX + CARD_PAD_SM + 56;
          styled.y = contentY + CARD_PAD_SM + accentHeaderH + idx * textItemH;
          styled.width = colW - CARD_PAD_SM * 2 - 56;
          styled.height = textItemH;
          styled.fontSize = fitFontSize(styled.text, colW - CARD_PAD_SM * 2, textItemH, leftCols.length > 2 ? 18 : 22);
          styled.bold = idx === 0;
          styled.color = colors.body;
          styled.align = "left";
          elements.push(styled);
        });
      }

      if (rightCols.length > 0) {
        const textH = contentH - CARD_PAD * 2 - accentHeaderH;
        const textItemH = textH / rightCols.length;
        rightCols.forEach((el, idx) => {
          const styled = assignTextRole(el, idx === 0 ? "kicker" : "body");
          styled.x = rightX + CARD_PAD_SM + 56;
          styled.y = contentY + CARD_PAD_SM + accentHeaderH + idx * textItemH;
          styled.width = colW - CARD_PAD_SM * 2 - 56;
          styled.height = textItemH;
          styled.fontSize = fitFontSize(styled.text, colW - CARD_PAD_SM * 2, textItemH, rightCols.length > 2 ? 18 : 22);
          styled.bold = idx === 0;
          styled.color = colors.body;
          styled.align = "left";
          elements.push(styled);
        });
      }
    } else if (layout === "process") {
      const steps = bodyTexts;
      const N = steps.length || 1;
      const cardGap = CARD_GAP;
      const totalW = CANVAS_CONTENT_W;
      const colW = (totalW - (N - 1) * cardGap) / N;
      const cardTop = contentY + CARD_PAD_SM;
      const cardH = contentH - CARD_PAD * 2;
      const badgeSize = 32;
      const accentOffset = 48;

      steps.forEach((el, idx) => {
        const colX = CANVAS_CONTENT_X + idx * (colW + cardGap);
        elements.unshift(createCard(colX, cardTop, colW, cardH));
        elements.push(createAccentBar(colX + CARD_PAD_SM, cardTop + CARD_PAD_SM, colW - CARD_PAD_SM * 2));

        const badgeX = colX + colW / 2 - badgeSize / 2;
        const badgeY = cardTop + CARD_PAD_SM + 4;
        elements.push(createStepBadge(badgeX, badgeY, badgeSize));
        elements.push(
          assignTextRole(
            {
              id: `num-${generateId()}`,
              type: "text",
              x: badgeX,
              y: badgeY,
              width: badgeSize,
              height: badgeSize,
              text: String(idx + 1),
              fontSize: 16,
              bold: true,
              color: colors.bg,
              align: "center",
              provenance: "layout",
            },
            "caption",
          ),
        );

        const styled = assignTextRole(el, "body");
        styled.x = colX + CARD_PAD_SM;
        styled.y = cardTop + accentOffset;
        styled.width = colW - CARD_PAD_SM * 2;
        styled.height = cardH - accentOffset - CARD_PAD_SM;
        styled.fontSize = fitFontSize(
          styled.text,
          colW - CARD_PAD_SM * 2,
          cardH - accentOffset - CARD_PAD_SM,
          20,
        );
        styled.bold = false;
        styled.color = colors.body;
        styled.align = "center";
        elements.push(styled);

        if (idx < N - 1) {
          const arrowX = colX + colW + 4;
          const arrowY = cardTop + cardH / 2 - 12;
          elements.push(createProcessArrow(arrowX, arrowY, cardGap - 8, 24));
        }
      });
    } else if (layout === "architecture") {
      const layers = bodyTexts;
      const N = layers.length || 1;
      const layerGap = CARD_GAP - 12;
      const layerH = (contentH - (N - 1) * layerGap) / N;
      const accentW = 6;

      layers.forEach((el, idx) => {
        const rowY = contentY + idx * (layerH + layerGap);
        elements.unshift(createCard(CANVAS_CONTENT_X, rowY, CANVAS_CONTENT_W, layerH));
        elements.push(
          createAccentBlock(
            CANVAS_CONTENT_X + CARD_PAD_SM,
            rowY + CARD_PAD_SM,
            accentW,
            layerH - CARD_PAD_SM * 2,
            { opacity: 1, radius: VISUAL_TOKENS.radii.pill },
          ),
        );

        const styled = assignTextRole(el, "kicker");
        styled.x = CANVAS_CONTENT_X + CARD_PAD_SM + accentW + 16;
        styled.y = rowY + 10;
        styled.width = CANVAS_CONTENT_W - CARD_PAD_SM * 2 - accentW - 16;
        styled.height = layerH - 20;
        styled.fontSize = fitFontSize(styled.text, styled.width, layerH - 20, 22);
        styled.bold = true;
        styled.color = colors.title;
        styled.align = "center";
        elements.push(styled);
      });
    } else if (layout === "case") {
      const descText = bodyTexts[0];
      const metricText = bodyTexts[1];

      const leftX = 120;
      const leftW = 600;
      const rightX = 760;
      const rightW = 400;
      const pad = 24;

      elements.unshift(createCard(leftX, contentY, leftW, contentH));
      elements.unshift(createCard(rightX, contentY, rightW, contentH));
      elements.push(createAccentBlock(leftX + pad, contentY + pad, 6, 80, { opacity: 1, radius: VISUAL_TOKENS.radii.pill }));

      const sideImage =
        pickImageForSlot("side") ??
        (imageElements.length === 1 && !imageElements[0].imageSlot
          ? imageElements[0]
          : pickImageForSlot("side", true));

      // Never drop body text: the right column holds one image OR one metric.
      // Overflow bullets fold into the left desc so no content is lost.
      const foldStart = sideImage ? 1 : 2;
      const foldedExtras = bodyTexts
        .slice(foldStart)
        .map((el) => el.text.trim())
        .filter(Boolean);

      if (descText) {
        const styled = assignTextRole(descText, "body");
        styled.x = leftX + pad + 16;
        styled.y = contentY + pad;
        styled.width = leftW - pad * 2 - 16;
        styled.height = contentH - pad * 2;
        if (foldedExtras.length > 0) {
          styled.text = [styled.text.trim(), ...foldedExtras].join("\n");
        }
        styled.fontSize = fitFontSize(styled.text, leftW - pad * 2, contentH - pad * 2, 20);
        styled.bold = false;
        styled.color = colors.body;
        styled.align = "left";
        elements.push(styled);
      }

      if (sideImage) {
        elements.push(
          placeImageInSlot(
            sideImage,
            {
              x: rightX + pad,
              y: contentY + pad,
              width: rightW - pad * 2,
              height: contentH - pad * 2,
            },
            "side",
          ),
        );
      } else if (metricText) {
        const styled = assignTextRole(metricText, "metric");
        styled.x = rightX + pad;
        styled.y = contentY + 40;
        styled.width = rightW - pad * 2;
        styled.height = contentH - 80;
        styled.fontSize = fitFontSize(styled.text, rightW - pad * 2, contentH - 80, 32, 20);
        styled.bold = true;
        styled.color = colors.accent;
        styled.align = "center";
        elements.push(styled);
      }
    } else if (layout === "toc") {
      const items = bodyTexts;
      const N = items.length || 1;
      const stack = resolveVerticalStackMetrics(N, contentH, 12, 8);
      const rowGap = stack.gap;
      const rowH = stack.rowHeight;
      const rowInset = stack.inset;
      const badgeSize = Math.min(36, rowH);
      const textX = 180;
      const textW = 960;

      elements.unshift(
        createAccentBlock(168, contentY, 4, contentH, {
          opacity: 0.25,
          radius: VISUAL_TOKENS.radii.pill,
        }),
      );

      items.forEach((el, idx) => {
        const rowY = contentY + idx * (rowH + rowGap);
        elements.unshift(createCard(120, rowY, 1040, rowH));

        elements.push(createStepBadge(140, rowY + (rowH - badgeSize) / 2, badgeSize));

        const numLabel = assignTextRole(
          {
            id: `num-${generateId()}`,
            type: "text",
            x: 140,
            y: rowY + (rowH - badgeSize) / 2,
            width: badgeSize,
            height: badgeSize,
            text: String(idx + 1),
            fontSize: 18,
            bold: true,
              color: colors.bg,
              align: "center",
              provenance: "layout",
            },
          "caption",
        );
        elements.push(numLabel);

        const styled = assignTextRole(el, "body");
        styled.x = textX;
        styled.y = rowY + rowInset;
        styled.width = textW;
        styled.height = rowH - rowInset * 2;
        styled.fontSize = fitFontSize(styled.text, textW, styled.height, 22);
        styled.bold = false;
        styled.color = colors.body;
        styled.align = "left";
        elements.push(styled);
      });
    } else if (layout === "quote") {
      const quoteText = bodyTexts[0];
      const attribution = bodyTexts.length > 1 ? bodyTexts[bodyTexts.length - 1] : undefined;
      const quoteExtras = bodyTexts
        .slice(1, bodyTexts.length - 1)
        .map((el) => el.text.trim())
        .filter(Boolean);

      elements.unshift(createCard(140, contentY + 20, 1000, contentH - 40));
      elements.unshift(
        createAccentBlock(160, contentY + 36, 80, 80, {
          opacity: 0.1,
          radius: VISUAL_TOKENS.radii.lg,
        }),
      );

      if (quoteText) {
        const styled = assignTextRole(quoteText, "kicker");
        styled.x = 180;
        styled.y = contentY + 56;
        styled.width = 920;
        styled.height = contentH - 160;
        if (quoteExtras.length > 0) {
          styled.text = [styled.text.trim(), ...quoteExtras].join("\n");
        }
        styled.fontSize = fitFontSize(styled.text, 920, contentH - 160, 36);
        styled.bold = false;
        styled.color = colors.title;
        styled.align = "center";
        styled.fontFamily = style.typography.family;
        elements.push(styled);
      }

      elements.push(
        createAccentBlock(440, contentY + contentH - 56, 400, 8, {
          opacity: 0.5,
          radius: VISUAL_TOKENS.radii.pill,
        }),
      );

      if (attribution) {
        const styled = assignTextRole(attribution, "caption");
        styled.x = 180;
        styled.y = contentY + contentH - 80;
        styled.width = 920;
        styled.height = 48;
        styled.fontSize = 18;
        styled.bold = false;
        styled.color = colors.body;
        styled.align = "center";
        elements.push(styled);
      }
    } else if (layout === "image-grid") {
      const gridCount = Math.min(
        Math.max(imageElements.length, bodyTexts.length, 1),
        4,
      );
      const unslottedImages = imageElements.filter(
        (img) => !img.imageSlot && !placedImageIds.has(img.id),
      );

      for (let idx = 0; idx < gridCount; idx += 1) {
        const slotKey = `grid-${idx}`;
        const rect = getImageGridSlotRect(idx, gridCount);
        if (!rect) continue;

        elements.unshift(createCard(rect.x, rect.y, rect.width, rect.height));

        const cardImage =
          pickImageForSlot(slotKey) ?? unslottedImages.shift();
        if (cardImage) {
          elements.push(
            placeImageInSlot(
              cardImage,
              {
                x: rect.x + 12,
                y: rect.y + 12,
                width: rect.width - 24,
                height: rect.height - (bodyTexts[idx] ? 52 : 24),
              },
              slotKey,
            ),
          );
        }

        if (bodyTexts[idx]) {
          const styled = assignTextRole(bodyTexts[idx], "caption");
          styled.x = rect.x + 12;
          styled.y = rect.y + rect.height - 44;
          styled.width = rect.width - 24;
          styled.height = 32;
          styled.fontSize = fitFontSize(styled.text, rect.width - 24, 32, 16);
          styled.bold = false;
          styled.color = colors.body;
          styled.align = "center";
          elements.push(styled);
        }
      }
    } else if (layout === "concept") {
      const N = bodyTexts.length || 1;
      const cardGap = CARD_GAP;
      const totalW = CANVAS_CONTENT_W;
      const colW = (totalW - (N - 1) * cardGap) / N;
      const imageAreaH = 100;
      const unslottedImages = imageElements.filter(
        (img) => !img.imageSlot && !placedImageIds.has(img.id),
      );

      bodyTexts.forEach((el, idx) => {
        const colX = CANVAS_CONTENT_X + idx * (colW + cardGap);
        const slotKey = `grid-${idx}`;
        const cardImage =
          pickImageForSlot(slotKey) ?? unslottedImages.shift();

        elements.unshift(createCard(colX, contentY, colW, contentH));
        elements.push(createAccentBlock(colX + CARD_PAD, contentY + CARD_PAD_SM, colW - CARD_PAD * 2, 8, { opacity: 0.85, radius: VISUAL_TOKENS.radii.pill }));

        const hasImage = Boolean(cardImage);
        const accentOffset = 20;
        const textH = hasImage
          ? contentH - imageAreaH - CARD_PAD * 2 - accentOffset
          : contentH - CARD_PAD * 2 - accentOffset;

        const styled = assignTextRole(el, idx === 0 ? "kicker" : "body");
        styled.x = colX + CARD_PAD;
        styled.y = contentY + CARD_PAD_SM + accentOffset;
        styled.width = colW - CARD_PAD * 2;
        styled.height = textH;
        styled.fontSize = fitFontSize(styled.text, colW - CARD_PAD * 2, textH, 20);
        styled.bold = idx === 0;
        styled.color = idx === 0 ? colors.title : colors.body;
        styled.align = "left";
        elements.push(styled);

        if (cardImage) {
          elements.push(
            placeImageInSlot(
              cardImage,
              {
                x: colX + CARD_PAD,
                y: contentY + contentH - imageAreaH - CARD_PAD_SM,
                width: colW - CARD_PAD * 2,
                height: imageAreaH,
              },
              slotKey,
            ),
          );
        }
      });
    } else {
      const N = bodyTexts.length || 1;
      const stack = resolveVerticalStackMetrics(N, contentH, ROW_GAP, CARD_PAD_SM);
      const rowGap = stack.gap;
      const rowH = stack.rowHeight;
      const rowInset = stack.inset;

      bodyTexts.forEach((el, idx) => {
        const rowY = contentY + idx * (rowH + rowGap);
        elements.unshift(createCard(CANVAS_CONTENT_X, rowY, CANVAS_CONTENT_W, rowH));
        elements.push(createAccentBlock(CANVAS_CONTENT_X + 10, rowY + rowInset, 6, rowH - rowInset * 2, { opacity: 1, radius: VISUAL_TOKENS.radii.pill }));

        const styled = assignTextRole(el, "body");
        styled.x = CANVAS_CONTENT_X + 30;
        styled.y = rowY + rowInset;
        styled.width = CANVAS_CONTENT_W - 40;
        styled.height = rowH - rowInset * 2;
        styled.fontSize = fitFontSize(styled.text, CANVAS_CONTENT_W - 40, styled.height, 20);
        styled.bold = false;
        styled.color = colors.body;
        styled.align = "left";
        elements.push(styled);
      });
    }
  }

  // Re-append unplaced images, custom user shapes, and data/icon elements
  const remainingImages = imageElements.filter((img) => !placedImageIds.has(img.id));
  const userDataElements = workingSlide.elements.filter(
    (el) => el.type === "chart" || el.type === "table" || el.type === "icon",
  );
  elements.push(...remainingImages);
  elements.push(...userShapes);
  elements.push(...userDataElements);

  const defaultBackgroundVariant = (layoutRegistry.get(layout)?.defaultBackgroundVariant ??
    resolveLayoutBackgroundVariant(layout)) as BackgroundVariant;
  const backgroundVariant = defaultBackgroundVariant;

  return {
    ...workingSlide,
    layout,
    grammarVariant: appliedGrammarVariant,
    designOverride: options.designOverride ?? slide.designOverride,
    backgroundVariant,
    slideVariant: slide.slideVariant ?? layoutRegistry.get(layout)?.defaultSlideVariant,
    elements,
  };
}
