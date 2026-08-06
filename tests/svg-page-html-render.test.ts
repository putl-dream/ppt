import { describe, expect, it } from "vitest";
import { createSvgVisualSource } from "../src/shared/presentation-fixtures";
import { renderSlideHtml } from "../src/shared/slide-html-render";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

describe("SVG page HTML rendering", () => {
  it("renders the SVG source as the only full-canvas visual", () => {
    const markup = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
      '<rect width="1280" height="720" fill="#123456"/>',
      '<text x="80" y="120">SVG 同源页面</text>',
      "</svg>",
    ].join("");
    const slide = {
      id: "slide-1",
      title: "SVG page",
      visualSource: createSvgVisualSource({
        markup,
        sourcePath: "slides/svg/slide-1.svg",
        title: "SVG page",
      }),
    };

    const html = renderSlideHtml(slide, 0, TEST_DESIGN_SYSTEM);
    const encoded = html.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)?.[1];

    expect(encoded).toBeDefined();
    expect(Buffer.from(encoded!, "base64").toString("utf8")).toBe(markup);
    expect(html).toContain('class="slide slide-svg"');
    expect(html).toContain('class="slide-svg-source"');
    expect(html).not.toContain("slide-header");
    expect(html).not.toContain("export-brand-logo");
    expect(html).not.toContain("Agent PPT");
  });
});
