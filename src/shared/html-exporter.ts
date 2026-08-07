import type { Presentation } from "@shared/presentation";
import { type DeckHtmlRenderOptions, exportDeckHtml } from "./slide-html-render";

export {
  exportDeckContactSheetHtml,
  exportSlideThumbnailHtml,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
} from "./slide-html-render";

export function exportToHtml(
  presentation: Presentation,
  options: DeckHtmlRenderOptions = {},
): string {
  return exportDeckHtml(presentation, options);
}
