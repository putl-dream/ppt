import type { Presentation, Slide } from "@shared/presentation";
import type { DesignSystemV2 } from "@design-system";
import { utf8ToBase64 } from "./base64";

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

export function renderSlideHtml(
  slide: Slide,
  index: number,
  _designSystem: DesignSystemV2,
  _options: DeckHtmlRenderOptions = {},
): string {
  if (slide.visualSource?.kind === "svg") {
    const svgDataUri = `data:image/svg+xml;base64,${utf8ToBase64(slide.visualSource.markup)}`;
    return `
<section class="slide slide-svg" data-index="${index}">
  <img class="slide-svg-source" src="${svgDataUri}" alt="${escapeHtml(slide.title)}" />
</section>`;
  }

  throw new Error(
    `Slide '${slide.title}' is not SVG-native; element-IR HTML render has been removed.`,
  );
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
  .slide-svg { background: #ffffff; }
  .slide-svg-source {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: fill;
  }
`;

/** Standalone HTML document for a single slide (used by thumbnail capture). */
export function exportSlideThumbnailHtml(
  slide: Slide,
  options: { designSystem: DesignSystemV2; index?: number },
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

export function exportDeckContactSheetHtml(
  presentation: Presentation,
  options: DeckHtmlRenderOptions = {},
): string {
  const scale = 0.3;
  const thumbnailWidth = Math.round(SLIDE_WIDTH * scale);
  const thumbnailHeight = Math.round(SLIDE_HEIGHT * scale);
  const items = presentation.slides.map((slide, index) => {
    const scene = slide.sceneRef
      ? `${slide.sceneRef.sceneId} / ${slide.sceneRef.variantId}`
      : slide.narrative?.role ?? slide.visualSource.sourcePath;
    return `
      <article class="contact-item">
        <div class="contact-meta">
          <strong>${String(index + 1).padStart(2, "0")}</strong>
          <span>${escapeHtml(scene)}</span>
        </div>
        <div class="contact-frame">
          <div class="contact-scale">
            ${renderSlideHtml(slide, index, presentation.designSystem, options)}
          </div>
        </div>
      </article>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(presentation.title)}｜Contact Sheet</title>
  <style>
    ${SLIDE_BASE_STYLES}
    :root { color-scheme: dark; }
    body {
      width: auto;
      height: auto;
      overflow: auto;
      background: #080d18;
      color: #f8fafc;
      padding: 28px;
    }
    .contact-header {
      max-width: 840px;
      margin: 0 auto 22px;
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
    }
    .contact-header h1 { font-size: 25px; line-height: 1.2; }
    .contact-header p { color: #94a3b8; font-size: 13px; white-space: nowrap; }
    .contact-grid {
      max-width: 840px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(2, ${thumbnailWidth}px);
      gap: 24px 28px;
    }
    .contact-item { width: ${thumbnailWidth}px; }
    .contact-meta {
      height: 28px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #94a3b8;
      font-size: 11px;
      letter-spacing: .02em;
    }
    .contact-meta strong { color: #60a5fa; font-size: 13px; }
    .contact-frame {
      width: ${thumbnailWidth}px;
      height: ${thumbnailHeight}px;
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, .28);
      border-radius: 6px;
      background: #111827;
      box-shadow: 0 12px 28px rgba(0, 0, 0, .28);
    }
    .contact-scale {
      width: ${SLIDE_WIDTH}px;
      height: ${SLIDE_HEIGHT}px;
      transform: scale(${scale});
      transform-origin: top left;
    }
    .contact-scale .slide { margin: 0; border-radius: 0; box-shadow: none; }
  </style>
</head>
<body>
  <header class="contact-header">
    <div>
      <h1>${escapeHtml(presentation.title)}</h1>
    </div>
    <p>${presentation.slides.length} slides · editorial-business</p>
  </header>
  <main class="contact-grid">${items}</main>
</body>
</html>`;
}
