import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement } from "./presentation";
import {
  resolveCoverTitleFont,
  resolveFontFamily,
  type TextRole,
} from "./typography";
import { resolveLayoutBackgroundVariant, type BackgroundVariant } from "./slide-background";

interface ThemeColors {
  bg: string;
  title: string;
  body: string;
  accent: string;
  cardBg: string;
  cardStroke: string;
}

const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15);
};

export function getThemePaletteColors(theme: string, palette: string): ThemeColors {
  let bg = "#ffffff";
  let title = "#1e293b";
  let body = "#475569";
  let accent = "#0ea5e9";
  let cardBg = "#f8fafc";
  let cardStroke = "#e2e8f0";

  switch (palette) {
    case "cyan":
      accent = "#0ea5e9";
      break;
    case "green":
      accent = "#10b981";
      break;
    case "purple":
      accent = "#a855f7";
      break;
    case "orange":
      accent = "#f97316";
      break;
  }

  switch (theme) {
    case "nordic":
      bg = "#fbfbfa";
      title = "#0f172a";
      body = "#334155";
      cardBg = "#f1f1f0";
      cardStroke = "#e1e1e0";
      break;
    case "midnight":
      bg = "#0e1115";
      title = "#f8fafc";
      body = "#94a3b8";
      cardBg = "#161b22";
      cardStroke = "#30363d";
      if (palette === "cyan") accent = "#58a6ff";
      break;
    case "ocean":
      bg = "#0f172a";
      title = "#f8fafc";
      body = "#cbd5e1";
      cardBg = "#1e293b";
      cardStroke = "#334155";
      if (palette === "cyan") accent = "#38bdf8";
      break;
    case "sunset":
      bg = "#fffcf4";
      title = "#3c2a21";
      body = "#776b5d";
      cardBg = "#fff8eb";
      cardStroke = "#ffe8cc";
      if (palette === "cyan") accent = "#e65100";
      break;
    case "purple":
      bg = "#1c1537";
      title = "#f8fafc";
      body = "#b4befe";
      cardBg = "#2b2050";
      cardStroke = "#44357a";
      if (palette === "cyan") accent = "#c084fc";
      break;
  }

  return { bg, title, body, accent, cardBg, cardStroke };
}

export function applyLayout(
  slide: Slide,
  layout: "cover" | "section" | "concept" | "comparison" | "process" | "architecture" | "case" | "summary",
  theme: string,
  palette: string
): Slide {
  const colors = getThemePaletteColors(theme, palette);

  // Separate elements by type
  let textElements = slide.elements.filter((el): el is TextElement => el.type === "text");
  const imageElements = slide.elements.filter((el) => el.type === "image");
  
  // Keep non-rectangle shapes (like custom lines or circles added by user)
  const userShapes = slide.elements.filter((el) => el.type === "shape" && el.shapeType !== "rectangle");

  if (textElements.length === 0) {
    return slide;
  }

  const isChromeLayout = layout === "cover" || layout === "section";
  const normalizedTitle = slide.title.trim();

  // Drop canvas text that duplicates the chrome header title on content slides.
  if (!isChromeLayout) {
    textElements = textElements.filter(
      (el) => el.text.trim() !== normalizedTitle && el.fontSize < 36,
    );
  }

  const titleEl = isChromeLayout
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
    shapeType: "rectangle",
    x,
    y,
    width: w,
    height: h,
    fillColor: colors.cardBg,
    strokeColor: colors.cardStroke,
  });

  const createAccentBar = (x: number, y: number, w: number): ShapeElement => ({
    id: `accent-${generateId()}`,
    type: "shape",
    shapeType: "rectangle",
    x,
    y,
    width: w,
    height: 4,
    fillColor: colors.accent,
    strokeColor: colors.accent,
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

  if (layout === "cover" || layout === "section") {
    const coverTitleEl = titleEl ?? bodyTexts[0];
    if (!coverTitleEl) {
      return slide;
    }
    const coverBodyTexts = titleEl ? bodyTexts : bodyTexts.slice(1);

    if (layout === "cover") {
      coverTitleEl.x = 120;
      coverTitleEl.y = 200;
      coverTitleEl.width = 1040;
      coverTitleEl.height = 160;
      coverTitleEl.fontSize = 56;
      coverTitleEl.bold = true;
      coverTitleEl.color = colors.title;
      coverTitleEl.align = "center";
      coverTitleEl.fontFamily = resolveCoverTitleFont(theme);
      elements.push(coverTitleEl);

      if (coverBodyTexts[0]) {
        const sub = assignTextRole(coverBodyTexts[0], "body");
        sub.x = 120;
        sub.y = 380;
        sub.width = 1040;
        sub.height = 100;
        sub.fontSize = 28;
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
      coverTitleEl.x = 120;
      coverTitleEl.y = 240;
      coverTitleEl.width = 1040;
      coverTitleEl.height = 120;
      coverTitleEl.fontSize = 48;
      coverTitleEl.bold = true;
      coverTitleEl.color = colors.title;
      coverTitleEl.align = "center";
      coverTitleEl.fontFamily = resolveCoverTitleFont(theme);
      elements.push(coverTitleEl);

      if (coverBodyTexts[0]) {
        const sub = assignTextRole(coverBodyTexts[0], "kicker");
        sub.x = 120;
        sub.y = 380;
        sub.width = 1040;
        sub.height = 140;
        sub.fontSize = 24;
        sub.bold = false;
        sub.color = colors.body;
        sub.align = "center";
        elements.push(sub);
      }
    }
  } else {
    // slide.title is rendered in chrome (Canvas / PPTMirror / export header).
    // Only body elements belong on the canvas here.
    const contentY = 200;
    const contentH = 430;

    if (layout === "comparison") {
      const leftCols: TextElement[] = [];
      const rightCols: TextElement[] = [];
      bodyTexts.forEach((el, idx) => {
        if (idx % 2 === 0) leftCols.push(el);
        else rightCols.push(el);
      });

      const colW = 480;
      const leftX = 120;
      const rightX = 680;

      elements.unshift(createCard(leftX, contentY, colW, contentH));
      elements.unshift(createCard(rightX, contentY, colW, contentH));

      if (leftCols.length > 0) {
        const textH = contentH - 40;
        const textItemH = textH / leftCols.length;
        leftCols.forEach((el, idx) => {
          const styled = assignTextRole(el, idx === 0 ? "kicker" : "body");
          styled.x = leftX + 24;
          styled.y = contentY + 20 + idx * textItemH;
          styled.width = colW - 48;
          styled.height = textItemH;
          styled.fontSize = leftCols.length > 2 ? 18 : 22;
          styled.bold = idx === 0;
          styled.color = colors.body;
          styled.align = "left";
          elements.push(styled);
        });
      }

      if (rightCols.length > 0) {
        const textH = contentH - 40;
        const textItemH = textH / rightCols.length;
        rightCols.forEach((el, idx) => {
          const styled = assignTextRole(el, idx === 0 ? "kicker" : "body");
          styled.x = rightX + 24;
          styled.y = contentY + 20 + idx * textItemH;
          styled.width = colW - 48;
          styled.height = textItemH;
          styled.fontSize = rightCols.length > 2 ? 18 : 22;
          styled.bold = idx === 0;
          styled.color = colors.body;
          styled.align = "left";
          elements.push(styled);
        });
      }
    } else if (layout === "process") {
      const steps = bodyTexts.slice(0, 4);
      const N = steps.length || 1;
      const cardGap = 24;
      const totalW = 1040;
      const colW = (totalW - (N - 1) * cardGap) / N;
      const cardTop = contentY + 40;
      const cardH = contentH - 80;

      steps.forEach((el, idx) => {
        const colX = 120 + idx * (colW + cardGap);
        elements.unshift(createCard(colX, cardTop, colW, cardH));
        elements.push(createAccentBar(colX + 16, cardTop + 12, colW - 32));

        const styled = assignTextRole(el, "body");
        styled.x = colX + 16;
        styled.y = contentY + 60;
        styled.width = colW - 32;
        styled.height = contentH - 120;
        styled.fontSize = 20;
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
      const layers = bodyTexts.slice(0, 4);
      const N = layers.length || 1;
      const layerGap = 20;
      const layerH = (contentH - (N - 1) * layerGap) / N;

      layers.forEach((el, idx) => {
        const rowY = contentY + idx * (layerH + layerGap);
        elements.unshift(createCard(120, rowY, 1040, layerH));

        const styled = assignTextRole(el, "kicker");
        styled.x = 140;
        styled.y = rowY + 10;
        styled.width = 1000;
        styled.height = layerH - 20;
        styled.fontSize = 22;
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

      if (descText) {
        const styled = assignTextRole(descText, "body");
        styled.x = leftX + pad;
        styled.y = contentY + pad;
        styled.width = leftW - pad * 2;
        styled.height = contentH - pad * 2;
        styled.fontSize = 20;
        styled.bold = false;
        styled.color = colors.body;
        styled.align = "left";
        elements.push(styled);
      }

      const sideImage =
        pickImageForSlot("side") ??
        (imageElements.length === 1 && !imageElements[0].imageSlot
          ? imageElements[0]
          : pickImageForSlot("side", true));

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
        styled.fontSize = 32;
        styled.bold = true;
        styled.color = colors.accent;
        styled.align = "center";
        elements.push(styled);
      }
    } else if (layout === "concept") {
      const N = bodyTexts.length || 1;
      const cardGap = 24;
      const totalW = 1040;
      const colW = (totalW - (N - 1) * cardGap) / N;
      const imageAreaH = 100;
      const unslottedImages = imageElements.filter(
        (img) => !img.imageSlot && !placedImageIds.has(img.id),
      );

      bodyTexts.forEach((el, idx) => {
        const colX = 120 + idx * (colW + cardGap);
        const slotKey = `grid-${idx}`;
        const cardImage =
          pickImageForSlot(slotKey) ?? unslottedImages.shift();

        elements.unshift(createCard(colX, contentY, colW, contentH));
        elements.push(createAccentBar(colX + 20, contentY + 16, colW - 40));

        const hasImage = Boolean(cardImage);
        const textH = hasImage ? contentH - imageAreaH - 36 : contentH - 40;

        const styled = assignTextRole(el, idx === 0 ? "kicker" : "body");
        styled.x = colX + 20;
        styled.y = contentY + 20;
        styled.width = colW - 40;
        styled.height = textH;
        styled.fontSize = 20;
        styled.bold = idx === 0;
        styled.color = idx === 0 ? colors.title : colors.body;
        styled.align = "left";
        elements.push(styled);

        if (cardImage) {
          elements.push(
            placeImageInSlot(
              cardImage,
              {
                x: colX + 20,
                y: contentY + contentH - imageAreaH - 16,
                width: colW - 40,
                height: imageAreaH,
              },
              slotKey,
            ),
          );
        }
      });
    } else {
      const N = bodyTexts.length || 1;
      const rowGap = 16;
      const rowH = (contentH - (N - 1) * rowGap) / N;

      bodyTexts.forEach((el, idx) => {
        const rowY = contentY + idx * (rowH + rowGap);
        elements.unshift(createCard(120, rowY, 1040, rowH));
        elements.push({
          id: `accent-${generateId()}`,
          type: "shape",
          shapeType: "rectangle",
          x: 130,
          y: rowY + 12,
          width: 4,
          height: rowH - 24,
          fillColor: colors.accent,
          strokeColor: colors.accent,
        });

        const styled = assignTextRole(el, "body");
        styled.x = 150;
        styled.y = rowY + 10;
        styled.width = 980;
        styled.height = rowH - 20;
        styled.fontSize = 20;
        styled.bold = false;
        styled.color = colors.body;
        styled.align = "left";
        elements.push(styled);
      });
    }
  }

  // Re-append unplaced images and custom user shapes
  const remainingImages = imageElements.filter((img) => !placedImageIds.has(img.id));
  elements.push(...remainingImages);
  elements.push(...userShapes);

  return {
    ...slide,
    layout,
    backgroundVariant: resolveLayoutBackgroundVariant(layout) as BackgroundVariant,
    elements,
  };
}
