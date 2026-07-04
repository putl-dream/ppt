import type { Presentation } from "@shared/presentation";
import { exportDeckHtml } from "./slide-html-render";

export interface HtmlExportOptions {
  theme?: string;
  palette?: string;
}

export { exportSlideThumbnailHtml, SLIDE_WIDTH, SLIDE_HEIGHT } from "./slide-html-render";

export function exportToHtml(
  presentation: Presentation,
  options: HtmlExportOptions = {},
): string {
  return exportDeckHtml(presentation, options);
}
