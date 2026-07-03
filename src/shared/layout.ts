import type { Slide, SlideElement, TextElement, ShapeElement } from "./presentation";

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
      elements.push(coverTitleEl);

      if (coverBodyTexts[0]) {
        const sub = coverBodyTexts[0];
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
    } else {
      coverTitleEl.x = 120;
      coverTitleEl.y = 240;
      coverTitleEl.width = 1040;
      coverTitleEl.height = 120;
      coverTitleEl.fontSize = 48;
      coverTitleEl.bold = true;
      coverTitleEl.color = colors.title;
      coverTitleEl.align = "center";
      elements.push(coverTitleEl);

      if (coverBodyTexts[0]) {
        const sub = coverBodyTexts[0];
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
          el.x = leftX + 24;
          el.y = contentY + 20 + idx * textItemH;
          el.width = colW - 48;
          el.height = textItemH;
          el.fontSize = leftCols.length > 2 ? 18 : 22;
          el.bold = idx === 0;
          el.color = colors.body;
          el.align = "left";
          elements.push(el);
        });
      }

      if (rightCols.length > 0) {
        const textH = contentH - 40;
        const textItemH = textH / rightCols.length;
        rightCols.forEach((el, idx) => {
          el.x = rightX + 24;
          el.y = contentY + 20 + idx * textItemH;
          el.width = colW - 48;
          el.height = textItemH;
          el.fontSize = rightCols.length > 2 ? 18 : 22;
          el.bold = idx === 0;
          el.color = colors.body;
          el.align = "left";
          elements.push(el);
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

        el.x = colX + 16;
        el.y = contentY + 60;
        el.width = colW - 32;
        el.height = contentH - 120;
        el.fontSize = 20;
        el.bold = false;
        el.color = colors.body;
        el.align = "center";
        elements.push(el);

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

        el.x = 140;
        el.y = rowY + 10;
        el.width = 1000;
        el.height = layerH - 20;
        el.fontSize = 22;
        el.bold = true;
        el.color = colors.title;
        el.align = "center";
        elements.push(el);
      });
    } else if (layout === "case") {
      const descText = bodyTexts[0];
      const metricText = bodyTexts[1];

      const leftX = 120;
      const leftW = 600;
      const rightX = 760;
      const rightW = 400;

      elements.unshift(createCard(leftX, contentY, leftW, contentH));
      elements.unshift(createCard(rightX, contentY, rightW, contentH));

      if (descText) {
        descText.x = leftX + 24;
        descText.y = contentY + 24;
        descText.width = leftW - 48;
        descText.height = contentH - 48;
        descText.fontSize = 20;
        descText.bold = false;
        descText.color = colors.body;
        descText.align = "left";
        elements.push(descText);
      }

      if (metricText) {
        metricText.x = rightX + 24;
        metricText.y = contentY + 40;
        metricText.width = rightW - 48;
        metricText.height = contentH - 80;
        metricText.fontSize = 32;
        metricText.bold = true;
        metricText.color = colors.accent;
        metricText.align = "center";
        elements.push(metricText);
      }
    } else if (layout === "concept") {
      const N = bodyTexts.length || 1;
      const cardGap = 24;
      const totalW = 1040;
      const colW = (totalW - (N - 1) * cardGap) / N;

      bodyTexts.forEach((el, idx) => {
        const colX = 120 + idx * (colW + cardGap);
        elements.unshift(createCard(colX, contentY, colW, contentH));
        elements.push(createAccentBar(colX + 20, contentY + 16, colW - 40));

        el.x = colX + 20;
        el.y = contentY + 20;
        el.width = colW - 40;
        el.height = contentH - 40;
        el.fontSize = 20;
        el.bold = idx === 0;
        el.color = idx === 0 ? colors.title : colors.body;
        el.align = "left";
        elements.push(el);
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

        el.x = 150;
        el.y = rowY + 10;
        el.width = 980;
        el.height = rowH - 20;
        el.fontSize = 20;
        el.bold = false;
        el.color = colors.body;
        el.align = "left";
        elements.push(el);
      });
    }
  }

  // Re-append images and custom user shapes
  elements.push(...imageElements);
  elements.push(...userShapes);

  return {
    ...slide,
    layout,
    elements,
  };
}
