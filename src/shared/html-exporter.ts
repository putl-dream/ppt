import type { Presentation } from "@shared/presentation";
import { exportDeckHtml } from "./slide-html-render";

export { exportSlideThumbnailHtml, SLIDE_WIDTH, SLIDE_HEIGHT } from "./slide-html-render";

export function exportToHtml(
  presentation: Presentation,
): string {
  return exportDeckHtml(presentation);
}
