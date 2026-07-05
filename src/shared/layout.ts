import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement } from "./presentation";
import { getImageGridSlotRect } from "./layout-slots";
import type { SlideLayoutType } from "./slide-layouts";
import {
  resolveDesignTokenBackgroundVariant,
  resolveDesignTokenColors,
  resolveDesignTokens,
  type DesignTokensV1,
} from "./design-tokens";
import {
  resolveCoverTitleFont,
  resolveFontFamily,
  type TextRole,
} from "./typography";
import { resolveLayoutBackgroundVariant, type BackgroundVariant } from "./slide-background";
import { cardShadow, VISUAL_TOKENS } from "./visual-tokens";
import { isUserPreservedShape } from "./layout-shape-utils";
import "./layout-register-builtin";
import "./layout-handlers/cover";
import { layoutRegistry } from "./layout-registry";
import { layoutGrammarRegistry } from "./layout-grammar";

interface ThemeColors {
  bg: string;
  title: string;
  body: string;
  accent: string;
  cardBg: string;
  cardStroke: string;
  muted?: string;
  softAccent?: string;
}

const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15);
};

const PALETTE_BASE_ACCENT: Record<string, string> = {
  cyan: "#0ea5e9",
  green: "#10b981",
  purple: "#a855f7",
  orange: "#f97316",
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

/**
 * Theme-adapted accent per palette. Dark themes get brighter variants, light
 * themes get more saturated ones, so all 4 palettes read distinctly instead of
 * only `cyan` being tuned. `cyan` values preserve prior behavior exactly.
 */
const THEME_ACCENT: Record<string, Record<string, string>> = {
  nordic: { cyan: "#0ea5e9", green: "#059669", purple: "#9333ea", orange: "#ea580c" },
  midnight: { cyan: "#58a6ff", green: "#3fb950", purple: "#bc8cff", orange: "#ffa657" },
  ocean: { cyan: "#38bdf8", green: "#34d399", purple: "#c084fc", orange: "#fb923c" },
  sunset: { cyan: "#e65100", green: "#059669", purple: "#9333ea", orange: "#ea580c" },
  purple: { cyan: "#c084fc", green: "#34d399", purple: "#c084fc", orange: "#fb923c" },
};

/** Resolve the accent color for a theme + palette pair. Shared by canvas + chrome. */
export function resolveThemeAccent(theme: string, palette: string): string {
  return (
    THEME_ACCENT[theme]?.[palette] ??
    PALETTE_BASE_ACCENT[palette] ??
    PALETTE_BASE_ACCENT.cyan
  );
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Linear blend of two #RRGGBB colors; `t` is the weight of `b` (0..1). */
function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string): [number, number, number] => {
    const clean = hex.replace("#", "");
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const to2 = (n: number) => clampChannel(n).toString(16).padStart(2, "0");
  return `#${to2(ar + (br - ar) * t)}${to2(ag + (bg - ag) * t)}${to2(ab + (bb - ab) * t)}`;
}

export function getThemePaletteColors(theme: string, palette: string): ThemeColors {
  let bg = "#ffffff";
  let title = "#1e293b";
  let body = "#475569";
  let cardBg = "#f8fafc";
  let baseStroke = "#e2e8f0";

  const accent = resolveThemeAccent(theme, palette);

  switch (theme) {
    case "nordic":
      bg = "#fbfbfa";
      title = "#0f172a";
      body = "#334155";
      cardBg = "#f1f1f0";
      baseStroke = "#e1e1e0";
      break;
    case "midnight":
      bg = "#0e1115";
      title = "#f8fafc";
      body = "#94a3b8";
      cardBg = "#161b22";
      baseStroke = "#30363d";
      break;
    case "ocean":
      bg = "#0f172a";
      title = "#f8fafc";
      body = "#cbd5e1";
      cardBg = "#1e293b";
      baseStroke = "#334155";
      break;
    case "sunset":
      bg = "#fffcf4";
      title = "#3c2a21";
      body = "#776b5d";
      cardBg = "#fff8eb";
      baseStroke = "#ffe8cc";
      break;
    case "purple":
      bg = "#1c1537";
      title = "#f8fafc";
      body = "#b4befe";
      cardBg = "#2b2050";
      baseStroke = "#44357a";
      break;
  }

  // Tint the card stroke toward the accent so palette choice reads on borders too.
  const cardStroke = mixHex(baseStroke, accent, 0.3);

  return { bg, title, body, accent, cardBg, cardStroke };
}

/** Approximate rendered width of a string in em units (CJK ≈ 1.0, others ≈ 0.55). */
export function estimateTextWidthUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    units += /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch)
      ? 1.0
      : 0.55;
  }
  return units;
}

/**
 * Estimate the largest fontSize (stepping down by 2 from baseSize) at which `text`
 * fits within a boxW × boxH box, honoring explicit newlines. Pure geometry — mirrors
 * the renderers' `line-height: 1.4` + `pre-wrap` behavior; never measures real glyphs.
 * Returns baseSize when the text already fits; never below minSize.
 */
export function fitFontSize(
  text: string,
  boxW: number,
  boxH: number,
  baseSize: number,
  minSize = 12,
): number {
  if (!text.trim() || boxW <= 0 || boxH <= 0) return baseSize;
  const paragraphs = text.split("\n");
  for (let size = baseSize; size > minSize; size -= 2) {
    const unitsPerLine = boxW / size;
    if (unitsPerLine <= 0) continue;
    const maxLines = Math.max(1, Math.floor(boxH / (size * 1.4)));
    let linesNeeded = 0;
    for (const paragraph of paragraphs) {
      const units = estimateTextWidthUnits(paragraph);
      linesNeeded += Math.max(1, Math.ceil(units / unitsPerLine));
    }
    if (linesNeeded <= maxLines) return size;
  }
  return minSize;
}

export function applyLayout(
  slide: Slide,
  layout: SlideLayoutType,
  theme: string,
  palette: string,
  options: {
    grammarVariant?: string;
    designTokens?: Partial<DesignTokensV1> | null;
  } = {},
): Slide {
  const requestedDesignTokens = options.designTokens ?? slide.designTokens;
  const hasExplicitDesignTokens = Boolean(requestedDesignTokens);
  const designTokens = resolveDesignTokens(requestedDesignTokens);
  const baseColors = getThemePaletteColors(theme, palette);
  const colors = hasExplicitDesignTokens
    ? resolveDesignTokenColors(designTokens, baseColors)
    : baseColors;
  const grammarVariant = options.grammarVariant ?? slide.grammarVariant;
  const workingSlide = structuredClone(slide);

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
    fontFamily: resolveFontFamily(el.fontFamily, role, theme),
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
  if (grammarHandler) {
    grammarHandler.apply({
      slide: workingSlide,
      theme,
      palette,
      colors,
      textElements,
      imageElements,
      userShapes,
      titleEl,
      bodyTexts,
      elements,
      placedImageIds,
      theme_: theme,
      helpers: {
        createCard,
        createAccentBlock,
        createAccentBar,
        createProcessArrow,
        assignTextRole,
        placeImageInSlot,
        pickImageForSlot,
      },
      designTokens,
      grammarVariant,
      hasExplicitDesignTokens,
    });
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
      coverTitleEl.fontFamily = resolveCoverTitleFont(theme);
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
      coverTitleEl.fontFamily = resolveCoverTitleFont(theme);
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
      const rowGap = 12;
      const rowH = (contentH - (N - 1) * rowGap) / N;
      const badgeSize = 36;
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
        styled.y = rowY + 8;
        styled.width = textW;
        styled.height = rowH - 16;
        styled.fontSize = fitFontSize(styled.text, textW, rowH - 16, 22);
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
        styled.fontFamily = resolveCoverTitleFont(theme);
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
      const rowGap = ROW_GAP;
      const rowH = (contentH - (N - 1) * rowGap) / N;

      bodyTexts.forEach((el, idx) => {
        const rowY = contentY + idx * (rowH + rowGap);
        elements.unshift(createCard(CANVAS_CONTENT_X, rowY, CANVAS_CONTENT_W, rowH));
        elements.push(createAccentBlock(CANVAS_CONTENT_X + 10, rowY + CARD_PAD_SM, 6, rowH - CARD_PAD_SM * 2, { opacity: 1, radius: VISUAL_TOKENS.radii.pill }));

        const styled = assignTextRole(el, "body");
        styled.x = CANVAS_CONTENT_X + 30;
        styled.y = rowY + CARD_PAD_SM;
        styled.width = CANVAS_CONTENT_W - 40;
        styled.height = rowH - CARD_PAD_SM * 2;
        styled.fontSize = fitFontSize(styled.text, CANVAS_CONTENT_W - 40, rowH - CARD_PAD_SM * 2, 20);
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
  const backgroundVariant = hasExplicitDesignTokens
    ? resolveDesignTokenBackgroundVariant(designTokens, defaultBackgroundVariant)
    : defaultBackgroundVariant;

  return {
    ...workingSlide,
    layout,
    grammarVariant,
    designTokens: hasExplicitDesignTokens ? designTokens : slide.designTokens,
    backgroundVariant,
    slideVariant: slide.slideVariant ?? layoutRegistry.get(layout)?.defaultSlideVariant,
    elements,
  };
}
