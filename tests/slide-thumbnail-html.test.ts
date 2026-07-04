import { describe, expect, it } from "vitest";
import { createStarterPresentation } from "../src/shared/presentation";
import {
  exportSlideThumbnailHtml,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
} from "../src/shared/slide-html-render";
import { exportToHtml } from "../src/shared/html-exporter";

describe("slide-html-render", () => {
  it("exports single-slide HTML at native slide dimensions", () => {
    const presentation = createStarterPresentation();
    const slide = presentation.slides[0]!;
    const html = exportSlideThumbnailHtml(slide, { theme: "nordic", palette: "cyan" });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(`width: ${SLIDE_WIDTH}px`);
    expect(html).toContain(`height: ${SLIDE_HEIGHT}px`);
    expect(html).toContain(slide.title);
  });

  it("keeps deck HTML export working via html-exporter", () => {
    const presentation = createStarterPresentation();
    const html = exportToHtml(presentation);

    expect(html).toContain(presentation.title);
    expect(html).toContain('class="slide"');
  });

  it("defines thumbnail target dimensions", () => {
    expect(THUMBNAIL_WIDTH).toBe(640);
    expect(THUMBNAIL_HEIGHT).toBe(360);
    expect(THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT).toBeCloseTo(SLIDE_WIDTH / SLIDE_HEIGHT);
  });
});
