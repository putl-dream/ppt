import type { Presentation } from "@shared/presentation";
import { exportDeckHtml, type DeckHtmlRenderOptions } from "./slide-html-render";

export { exportSlideThumbnailHtml, SLIDE_WIDTH, SLIDE_HEIGHT } from "./slide-html-render";

export function exportToHtml(
  presentation: Presentation,
  options: DeckHtmlRenderOptions = {},
): string {
  return exportDeckHtml(presentation, options);
}
