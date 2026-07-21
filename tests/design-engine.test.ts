import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_SYSTEM,
  designSystemV1Schema,
  evaluateDeckVisualQuality,
  resolveImageTreatment,
  resolveSlideStyle,
  BRAND_PERSONAS,
  DEFAULT_BRAND_PROFILE,
  resolveBrandProfileDesignSystem,
} from "@design-system";
import { executeCommand } from "../src/shared/commands";
import { applyLayout } from "../src/shared/layout";
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
  it("maps six brand personas to distinct deterministic token systems", () => {
    const signatures = BRAND_PERSONAS.map((persona) => {
      const first = resolveBrandProfileDesignSystem({
        ...DEFAULT_BRAND_PROFILE,
        brandName: persona,
        persona,
      });
      const second = resolveBrandProfileDesignSystem({
        ...DEFAULT_BRAND_PROFILE,
        brandName: persona,
        persona,
      });
      expect(first).toEqual(second);
      return JSON.stringify(first.tokens);
    });

    expect(new Set(signatures).size).toBe(BRAND_PERSONAS.length);
  });

  it("changes the rendered grammar silhouette when brand persona changes", () => {
    const contentSlide: Slide = {
      id: "persona-slide",
      title: "同一份内容",
      elements: ["观点一", "观点二", "观点三"].map((text, index) => ({
        id: `persona-text-${index}`,
        type: "text" as const,
        x: 0,
        y: 0,
        width: 300,
        height: 80,
        text,
        fontSize: 20,
      })),
    };
    const consulting = resolveBrandProfileDesignSystem({
      ...DEFAULT_BRAND_PROFILE,
      brandName: "Consulting",
      persona: "consulting",
    });
    const launch = resolveBrandProfileDesignSystem({
      ...DEFAULT_BRAND_PROFILE,
      brandName: "Launch",
      persona: "brand-launch",
    });
    const consultingSlide = applyLayout(
      contentSlide,
      "concept",
      resolveSlideStyle(consulting, contentSlide),
    );
    const launchSlide = applyLayout(
      contentSlide,
      "concept",
      resolveSlideStyle(launch, contentSlide),
    );

    expect(consultingSlide.grammarVariant).toBe("editorial-columns");
    expect(launchSlide.grammarVariant).toBe("statement-stack");
    expect(consultingSlide.elements.map(({ x, y, width, height }) => [x, y, width, height]))
      .not.toEqual(launchSlide.elements.map(({ x, y, width, height }) => [x, y, width, height]));
  });

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

  it("does not award an empty deck a perfect score", () => {
    const result = evaluateDeckVisualQuality(DEFAULT_DESIGN_SYSTEM, []);
    expect(result.scores.overall).toBe(0);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "empty-deck", severity: "error" }),
    ]));
  });

  it("penalizes overlapping foreground content", () => {
    const result = evaluateDeckVisualQuality(DEFAULT_DESIGN_SYSTEM, [{
      id: "overlap-slide",
      layout: "concept",
      elements: [
        {
          type: "text",
          x: 120,
          y: 180,
          width: 500,
          height: 160,
          text: "Primary content",
          fontSize: 28,
        },
        {
          type: "text",
          x: 180,
          y: 220,
          width: 500,
          height: 160,
          text: "Overlapping content",
          fontSize: 24,
        },
      ],
    }]);

    expect(result.slides[0].scores.composition).toBeLessThan(80);
    expect(result.slides[0].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "composition-bounds", severity: "error" }),
    ]));
  });
});
