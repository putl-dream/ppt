import type { Presentation, Slide, SlideElement } from "@shared/presentation";
import { fontFamilyToCss, resolveElementFontFamily } from "./typography";
import { resolveSlideBackgroundWithVariant } from "./slide-variant";
import { resolveIconPath } from "./icon-registry";
import { getThemePaletteColors } from "./layout";

export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
export const THUMBNAIL_WIDTH = 640;
export const THUMBNAIL_HEIGHT = 360;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderElementHtml(element: SlideElement, theme: string): string {
  const style = `position:absolute;left:${element.x}px;top:${element.y}px;width:${element.width}px;height:${element.height}px;`;

  if (element.type === "text") {
    const fontFamily = fontFamilyToCss(resolveElementFontFamily(element, theme));
    const textStyle = [
      style,
      `font-size:${element.fontSize}px`,
      element.bold ? "font-weight:bold" : "",
      element.color ? `color:${element.color}` : "",
      element.align ? `text-align:${element.align}` : "",
      `font-family:${fontFamily}`,
      "display:flex;align-items:center",
    ]
      .filter(Boolean)
      .join(";");
    return `<div style="${textStyle}">${escapeHtml(element.text)}</div>`;
  }

  if (element.type === "image") {
    return `<img src="${escapeHtml(element.url)}" style="${style}object-fit:${element.objectFit ?? "cover"};border-radius:${element.borderRadius ?? 0}px" alt="" />`;
  }

  if (element.type === "shape") {
    if (element.shapeType === "line") {
      return `<div style="${style}border-top:2px solid ${element.strokeColor}"></div>`;
    }
    const radius = element.shapeType === "circle" ? "50%" : "0";
    return `<div style="${style}background:${element.fillColor};border:2px solid ${element.strokeColor};border-radius:${radius}"></div>`;
  }

  if (element.type === "table") {
    const rows = element.rows
      .map((row, rowIdx) => {
        const tag = element.headerRow && rowIdx === 0 ? "th" : "td";
        const cells = row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    return `<div style="${style}overflow:hidden"><table style="width:100%;height:100%;border-collapse:collapse;font-size:14px">${rows}</table></div>`;
  }

  if (element.type === "icon") {
    const path = resolveIconPath(element.name);
    if (!path) return "";
    const color = element.color ?? "#0ea5e9";
    return `<div style="${style}"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="${element.strokeWidth ?? 2}"><path d="${path}"/></svg></div>`;
  }

  if (element.type === "chart") {
    const accent = element.accentColor ?? "#0ea5e9";
    const items =
      element.data.items ??
      (element.data.labels ?? []).map((label, i) => ({
        label,
        value: element.data.values?.[i] ?? 0,
      }));
    const max = Math.max(...items.map((item) => item.value), 1);
    const bars = items
      .map((item, idx) => {
        const h = (item.value / max) * 80;
        const x = 10 + idx * 20;
        return `<rect x="${x}" y="${90 - h}" width="16" height="${h}" fill="${accent}"/>`;
      })
      .join("");
    return `<div style="${style}"><svg viewBox="0 0 100 100" width="100%" height="100%">${bars}</svg></div>`;
  }

  return "";
}

export function renderSlideHtml(
  slide: Slide,
  index: number,
  theme: string,
  palette: string,
): string {
  const bg = resolveSlideBackgroundWithVariant(theme, palette, slide);
  const colors = getThemePaletteColors(theme, palette);
  const showChrome = slide.layout !== "cover" && slide.layout !== "section";
  const elementsHtml = slide.elements.map((el) => renderElementHtml(el, theme)).join("\n");

  const headerHtml = showChrome
    ? `<div class="slide-header" style="border-bottom:2px solid ${colors.accent}"><h2 style="color:${colors.title}">${escapeHtml(slide.title)}</h2></div>`
    : "";

  return `
<section class="slide" data-index="${index}" style="background:${bg.slideBg}">
  ${headerHtml}
  <div class="slide-canvas">${elementsHtml}</div>
</section>`;
}

const SLIDE_BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${SLIDE_WIDTH}px; height: ${SLIDE_HEIGHT}px; overflow: hidden; }
  body { font-family: system-ui, sans-serif; }
  .slide {
    position: relative;
    width: ${SLIDE_WIDTH}px;
    height: ${SLIDE_HEIGHT}px;
    overflow: hidden;
  }
  .slide-header { padding: 50px 120px 0; }
  .slide-header h2 { font-size: 36px; font-weight: bold; }
  .slide-canvas { position: relative; width: 100%; height: 100%; }
  table th, table td { border: 1px solid #e2e8f0; padding: 6px 10px; }
  table th { background: #f1f5f9; font-weight: 600; }
  tr:nth-child(even) td { background: #f8fafc; }
`;

/** Standalone HTML document for a single slide (used by thumbnail capture). */
export function exportSlideThumbnailHtml(
  slide: Slide,
  options: { theme: string; palette: string; index?: number } = { theme: "nordic", palette: "cyan" },
): string {
  const theme = options.theme;
  const palette = options.palette;
  const slideHtml = renderSlideHtml(slide, options.index ?? 0, theme, palette);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${SLIDE_WIDTH}, height=${SLIDE_HEIGHT}" />
  <title>${escapeHtml(slide.title)}</title>
  <style>${SLIDE_BASE_STYLES}</style>
</head>
<body>
  ${slideHtml}
</body>
</html>`;
}

export function exportDeckHtml(
  presentation: Presentation,
  options: { theme?: string; palette?: string } = {},
): string {
  const theme = presentation.theme ?? options.theme ?? "nordic";
  const palette = presentation.palette ?? options.palette ?? "cyan";

  const slidesHtml = presentation.slides
    .map((slide, idx) => renderSlideHtml(slide, idx, theme, palette))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(presentation.title)}</title>
  <style>
    ${SLIDE_BASE_STYLES}
    body { width: auto; height: auto; overflow: auto; background: #111; }
    .deck { max-width: ${SLIDE_WIDTH}px; margin: 0 auto; padding: 24px; }
    .slide { margin: 0 auto 24px; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
  </style>
</head>
<body>
  <div class="deck">
    <h1 style="color:#fff;margin-bottom:24px">${escapeHtml(presentation.title)}</h1>
    ${slidesHtml}
  </div>
</body>
</html>`;
}
