import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_SYSTEM,
  designSystemV1Schema,
  evaluateDeckVisualQuality,
  resolveImageTreatment,
  resolveSlideStyle,
} from "@design-system";
import { executeCommand } from "../src/shared/commands";
import { exportSlideThumbnailHtml } from "../src/shared/slide-html-render";
import type { Presentation, Slide } from "../src/shared/presentation";
import { testDesignSystem } from "./design-engine-test-utils";

const slide: Slide = {
  id: "slide-1",
  title: "Design engine",
  layout: "concept",
  elements: [],
};

describe("design engine", () => {
  it("requires a complete DesignSystemV1 contract", () => {
    expect(designSystemV1Schema.parse(DEFAULT_DESIGN_SYSTEM)).toEqual(DEFAULT_DESIGN_SYSTEM);
    expect(() => designSystemV1Schema.parse({ version: 1 })).toThrow();
  });

  it("merges slide override and resolves renderer-ready style", () => {
    const style = resolveSlideStyle(testDesignSystem({ palette: "warm-paper" }), {
      ...slide,
      designOverride: { backgroundStyle: "grid", chartStyle: "report", imageTreatment: "framed" },
    });
    expect(style.colors.accent).toBe("#b45309");
    expect(style.background.pattern).toEqual({ type: "grid", color: style.colors.cardStroke, size: 32 });
    expect(style.chart.style).toBe("report");
    expect(style.image.treatment).toBe("framed");
    expect(style.typography.family).toBe("serif");
  });

  it("adapts light/dark surfaces without changing palette identity", () => {
    const system = testDesignSystem({ palette: "warm-paper" });
    const dark = resolveSlideStyle(system, { ...slide, slideVariant: "dark" });
    const light = resolveSlideStyle(system, { ...slide, slideVariant: "light" });
    expect(dark.colors.title).toBe("#eff6ff");
    expect(dark.colors.accent).toBe("#b45309");
    expect(light.colors.title).toBe("#0f172a");
  });

  it("uses the same style contract in thumbnail HTML", () => {
    const system = testDesignSystem({ backgroundStyle: "grid", imageTreatment: "masked" });
    const html = exportSlideThumbnailHtml({
      ...slide,
      elements: [{
        id: "image-1", type: "image", x: 100, y: 100, width: 400, height: 200,
        url: "data:image/png;base64,AA==", borderRadius: 0,
      }],
    }, { designSystem: system });
    expect(html).toContain("32px 32px");
    expect(html).toContain("border-radius:9999px");
  });

  it("recompiles laid-out slides when the deck design system changes", () => {
    const presentation: Presentation = {
      id: "deck", title: "Deck", revision: 0, designSystem: DEFAULT_DESIGN_SYSTEM,
      slides: [{
        ...slide,
        elements: [
          { id: "a", type: "text", x: 0, y: 0, width: 400, height: 80, text: "A", fontSize: 24 },
          { id: "b", type: "text", x: 0, y: 0, width: 400, height: 80, text: "B", fontSize: 20 },
        ],
      }],
    };
    const system = testDesignSystem({ palette: "tech-dark", backgroundStyle: "dark" });
    const result = executeCommand(presentation, {
      id: "set-design", type: "set-design-system", designSystem: system,
    }).presentation;
    expect(result.designSystem).toEqual(system);
    expect(result.slides[0].elements.some((element) => element.type === "text" && element.color === "#bad3ee")).toBe(true);
  });

  it("resolves image treatment independently from renderers", () => {
    const treatment = resolveImageTreatment("framed", "plain", 0, {
      cardBg: "#fff", cardStroke: "#ddd",
    });
    expect(treatment.padding).toBe(8);
    expect(treatment.borderColor).toBe("#ddd");
  });

  it("scores visual quality and returns actionable issues", () => {
    const result = evaluateDeckVisualQuality(DEFAULT_DESIGN_SYSTEM, [{
      id: "dense-slide",
      layout: "concept",
      elements: [{
        type: "text",
        x: 120,
        y: 180,
        width: 1040,
        height: 440,
        text: "A".repeat(1200),
        fontSize: 12,
      }],
    }]);
    expect(result.scores.readability).toBeLessThan(75);
    expect(result.scores.density).toBeLessThan(75);
    expect(result.slides[0].issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["readability", "over-density", "missing-visual-anchor"]),
    );
  });
});
