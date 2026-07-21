import type { Presentation } from "@shared/presentation";
import {
  exportDeckContactSheetHtml,
  exportDeckHtml,
  type DeckHtmlRenderOptions,
} from "./slide-html-render";

export {
  exportDeckContactSheetHtml,
  exportSlideThumbnailHtml,
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
} from "./slide-html-render";

export function exportToHtml(
  presentation: Presentation,
  options: DeckHtmlRenderOptions = {},
): string {
  return exportDeckHtml(presentation, options);
}
