import { describe, expect, it } from "vitest";
import { createStarterPresentation } from "../src/shared/presentation";
import {
  resolveSlideVariant,
  SLIDE_VARIANTS,
} from "../src/shared/slide-variant";
import { resolveSlideStyle } from "@design-system";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";
import { exportToHtml } from "../src/shared/html-exporter";

describe("slide variant design system", () => {
  it("supports light/dark/hero slide variants", () => {
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

  it("preserves explicit slideVariant on SVG slides", () => {
    const presentation = createStarterPresentation();
    presentation.slides[0].slideVariant = "dark";
    expect(resolveSlideVariant(presentation.slides[0])).toBe("dark");
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

describe("resolveSlideVariant", () => {
  it("returns undefined when no variant or layout hint exists", () => {
    expect(resolveSlideVariant({})).toBeUndefined();
  });

  it("still infers hero and light variants from legacy layout hints", () => {
    expect(resolveSlideVariant({ layout: "cover" })).toBe("hero");
    expect(resolveSlideVariant({ layout: "quote" })).toBe("light");
  });
});
