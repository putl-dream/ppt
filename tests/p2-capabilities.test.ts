import { resolveSlideStyle } from "@design-system";
import { describe, expect, it } from "vitest";
import { exportToHtml } from "../src/shared/html-exporter";
import { createStarterPresentation } from "../src/shared/presentation-fixtures";
import { SLIDE_VARIANTS } from "../src/shared/slide-variant";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

describe("design-engine slideVariant hints", () => {
  it("supports light/dark/hero resolution hints", () => {
    expect(SLIDE_VARIANTS).toContain("light");
    expect(SLIDE_VARIANTS).toContain("dark");
    expect(SLIDE_VARIANTS).toContain("hero");
  });

  it("resolves light variant through the design engine", () => {
    const bg = resolveSlideStyle(TEST_DESIGN_SYSTEM, { slideVariant: "light" }).background;
    expect(bg.css).toBe("#f8fbff");
    expect(bg.fill).toBe("#f8fbff");
  });

  it("resolves dark variant to dark background", () => {
    const bg = resolveSlideStyle(TEST_DESIGN_SYSTEM, { slideVariant: "dark" }).background;
    expect(bg.fill).toBe("#07111f");
  });
});

describe("SVG HTML export", () => {
  it("exports presentation to HTML with SVG slides", () => {
    const presentation = createStarterPresentation();
    const html = exportToHtml(presentation);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("slide-svg");
    expect(html).toContain(presentation.title);
  });
});
