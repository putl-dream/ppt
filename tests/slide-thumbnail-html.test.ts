import { describe, expect, it } from "vitest";
import { createStarterPresentation } from "../src/shared/presentation";
import {
  exportDeckContactSheetHtml,
  exportSlideThumbnailHtml,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
} from "../src/shared/slide-html-render";
import { exportToHtml } from "../src/shared/html-exporter";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

describe("slide-html-render", () => {
  it("exports single-slide HTML at native slide dimensions", () => {
    const presentation = createStarterPresentation();
    const slide = presentation.slides[0]!;
    const html = exportSlideThumbnailHtml(slide, { designSystem: TEST_DESIGN_SYSTEM });

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

  it("exports a labeled contact-sheet item for every slide", () => {
    const presentation = createStarterPresentation();
    presentation.slides.push({
      ...structuredClone(presentation.slides[0]!),
      id: "second-slide",
      title: "Second slide",
      sceneRef: {
        packId: "editorial-business",
        sceneId: "split-case",
        variantId: "fact-sidebar",
      },
    });

    const html = exportDeckContactSheetHtml(presentation);

    expect(html.match(/class="contact-item"/g)).toHaveLength(2);
    expect(html).toContain("split-case / fact-sidebar");
    expect(html).toContain("grid-template-columns: repeat(2,");
  });
});
