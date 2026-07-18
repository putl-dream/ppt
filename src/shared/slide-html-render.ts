import type { Presentation, Slide, SlideElement } from "@shared/presentation";
import type { DesignSystemV1, ResolvedSlideStyle } from "@design-system";
import { resolveChromeTitleFontSize, resolveImageTreatment, resolveSlideStyle } from "@design-system";
import { fontFamilyToCss, resolveElementFontFamily } from "./typography";
import { chartDataToSvgString } from "./chart-utils";
import { resolveIconPath } from "./icon-registry";
import {
  shapeBorderRadius,
  shapeBoxShadow,
  shapeFillColor,
} from "./shape-render-utils";

export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
export const THUMBNAIL_WIDTH = 640;
export const THUMBNAIL_HEIGHT = 360;

export interface DeckHtmlRenderOptions {
  logoUrl?: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderElementHtml(
  element: SlideElement,
  style: ResolvedSlideStyle,
): string {
  const baseStyle = `position:absolute;left:${element.x}px;top:${element.y}px;width:${element.width}px;height:${element.height}px;`;

  if (element.type === "text") {
    const fontFamily = fontFamilyToCss(
      resolveElementFontFamily(element, style.typography.family),
    );
    const textStyle = [
      baseStyle,
      `font-size:${element.fontSize}px`,
      element.bold ? "font-weight:bold" : "",
      `color:${element.color ?? style.colors.body}`,
      element.align ? `text-align:${element.align}` : "",
      `font-family:${fontFamily}`,
      "display:flex;align-items:center;white-space:pre-wrap;line-height:1.4;overflow-wrap:anywhere",
    ]
      .filter(Boolean)
      .join(";");
    return `<div style="${textStyle}">${escapeHtml(element.text)}</div>`;
  }

  if (element.type === "image") {
    const treatment = resolveImageTreatment(
      element.imageTreatment,
      style.image.treatment,
      element.borderRadius,
      style.colors,
    );
    const crop = element.crop;
    const frameStyle = `${baseStyle}position:absolute;overflow:hidden;border-radius:${treatment.borderRadius}px;border:${treatment.borderWidth}px solid ${treatment.borderColor};padding:${treatment.padding}px;background:${treatment.backgroundColor};box-shadow:${treatment.boxShadow ?? "none"};box-sizing:border-box`;
    const imageStyle = crop
      ? `position:absolute;left:${-(crop.x / crop.width) * 100}%;top:${-(crop.y / crop.height) * 100}%;width:${100 / crop.width}%;height:${100 / crop.height}%;object-fit:fill`
      : `width:100%;height:100%;object-fit:${element.objectFit ?? "cover"}`;
    return `<div style="${frameStyle}"><img src="${escapeHtml(element.url)}" style="${imageStyle}" alt="${escapeHtml(element.asset?.description ?? "")}" /></div>`;
  }

  if (element.type === "shape") {
    if (element.shapeType === "line") {
      return `<div style="${baseStyle}border-top:2px solid ${element.strokeColor}"></div>`;
    }
    const fill = shapeFillColor(element);
    const radius = shapeBorderRadius(element);
    const shadow = shapeBoxShadow(element);
    const hasStroke =
      element.strokeColor &&
      element.strokeColor !== "transparent" &&
      element.strokeColor !== element.fillColor;
    const border = hasStroke ? `border:2px solid ${element.strokeColor};` : "";
    const shadowCss = shadow ? `box-shadow:${shadow};` : "";
    return `<div style="${baseStyle}background:${fill};${border}border-radius:${radius};${shadowCss}"></div>`;
  }

  if (element.type === "table") {
    const rows = element.rows
      .map((row, rowIdx) => {
        const tag = element.headerRow && rowIdx === 0 ? "th" : "td";
        const isStripe = element.zebraStripe && rowIdx % 2 === 1;
        const background = tag === "th"
          ? style.colors.muted
          : isStripe ? style.colors.cardBg : style.colors.bg;
        const cellStyle = `border:1px solid ${style.colors.cardStroke};padding:6px 10px;color:${style.colors.body};background:${background};white-space:normal;overflow-wrap:anywhere;${tag === "th" ? "font-weight:600" : ""}`;
        const cells = row.map((cell) => `<${tag} style="${cellStyle}">${escapeHtml(cell)}</${tag}>`).join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    return `<div style="${baseStyle}"><table style="width:100%;height:100%;border-collapse:collapse;font-size:14px;table-layout:fixed">${rows}</table></div>`;
  }

  if (element.type === "icon") {
    const path = resolveIconPath(element.name);
    if (!path) return "";
    const color = element.color ?? style.colors.accent;
    return `<div style="${baseStyle}"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="${element.strokeWidth ?? 2}"><path d="${path}"/></svg></div>`;
  }

  if (element.type === "chart") {
    const svg = chartDataToSvgString(
      element,
      style.colors.accent,
      style.chart.style,
      style.colors.body,
    );
    return `<div style="${baseStyle}">${svg}</div>`;
  }

  return "";
}

export function renderSlideHtml(
  slide: Slide,
  index: number,
  designSystem: DesignSystemV1,
  options: DeckHtmlRenderOptions = {},
): string {
  const style = resolveSlideStyle(designSystem, slide);
  const showChrome = slide.layout !== "cover" && slide.layout !== "section";
  const elementsHtml = slide.elements
    .map((el) => renderElementHtml(el, style))
    .join("\n");

  const headerHtml = showChrome
    ? `<div class="slide-header" style="border-bottom:2px solid ${style.colors.accent}"><h2 style="color:${style.colors.title};font-size:${resolveChromeTitleFontSize(slide.title)}px;white-space:nowrap">${escapeHtml(slide.title)}</h2></div>`
    : "";
  const logoHtml = options.logoUrl
    ? `<img class="export-brand-logo" src="${escapeHtml(options.logoUrl)}" alt="Brand logo" />`
    : "";

  return `
<section class="slide" data-index="${index}" style="background:${style.background.css};font-family:${style.typography.css}">
  ${headerHtml}
  ${logoHtml}
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
  .export-brand-logo {
    position: absolute;
    z-index: 2;
    top: 40px;
    right: 54px;
    width: 100px;
    height: 32px;
    object-fit: contain;
  }
  .slide-canvas { position: relative; width: 100%; height: 100%; }
  table th, table td { border: 1px solid #e2e8f0; padding: 6px 10px; }
  table th { background: #f1f5f9; font-weight: 600; }
`;

/** Standalone HTML document for a single slide (used by thumbnail capture). */
export function exportSlideThumbnailHtml(
  slide: Slide,
  options: { designSystem: DesignSystemV1; index?: number },
): string {
  const slideHtml = renderSlideHtml(slide, options.index ?? 0, options.designSystem);

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
  options: DeckHtmlRenderOptions = {},
): string {
  const slidesHtml = presentation.slides
    .map((slide, idx) => renderSlideHtml(slide, idx, presentation.designSystem, options))
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
