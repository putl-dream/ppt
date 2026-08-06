import {
  BRAND_PERSONAS,
  DEFAULT_BRAND_PROFILE,
  DEFAULT_DESIGN_SYSTEM,
  designSystemV2Schema,
  evaluateDeckVisualQuality,
  resolveBrandProfileDesignSystem,
  resolveImageTreatment,
  resolveSlideStyle,
} from "@design-system";
import { describe, expect, it } from "vitest";
import { executeCommand } from "../src/shared/commands";
import type { Slide, SlideNarrative } from "../src/shared/presentation";
import { createSvgTestSlide } from "../src/shared/presentation-fixtures";
import { testDesignSystem } from "./design-engine-test-utils";

const NARRATIVE: SlideNarrative = {
  role: "cover",
  coreMessage: "Design engine",
  audienceMove: "Review",
  rhythm: "anchor",
  layoutIntent: "One full-page SVG.",
};

const slide: Slide = createSvgTestSlide({
  id: "slide-1",
  title: "Design engine",
  narrative: NARRATIVE,
});

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
      return JSON.stringify(resolveSlideStyle(first, slide).layoutTokens);
    });

    expect(new Set(signatures).size).toBe(BRAND_PERSONAS.length);
  });

  it("requires a complete DesignSystemV2 contract", () => {
    expect(designSystemV2Schema.parse(DEFAULT_DESIGN_SYSTEM)).toEqual(DEFAULT_DESIGN_SYSTEM);
    expect(() => designSystemV2Schema.parse({ version: 1 })).toThrow();
  });

  it("merges slide override and resolves renderer-ready style", () => {
    const style = resolveSlideStyle(testDesignSystem({ colorScheme: "warm-paper" }), {
      ...slide,
      designOverride: { visualStyle: "data-journalism" },
    });
    expect(style.colors.accent).toBe("#b45309");
    expect(style.chart.style).toBe("report");
    expect(style.image.treatment).toBe("captioned");
    expect(style.typography.heading.family).toBe("serif");
    expect(style.typography.body.family).toBe("sans");
  });

  it("adapts light/dark surfaces without changing palette identity", () => {
    const system = testDesignSystem({ colorScheme: "warm-paper" });
    const dark = resolveSlideStyle(system, { ...slide, slideVariant: "dark" });
    const light = resolveSlideStyle(system, { ...slide, slideVariant: "light" });
    expect(dark.colors.title).toBe("#eff6ff");
    expect(dark.colors.accent).toBe("#b45309");
    expect(light.colors.title).toBe("#31251b");
  });

  it("stores design system changes without mutating SVG page content", () => {
    const presentation = {
      id: "deck",
      title: "Deck",
      revision: 0,
      designSystem: DEFAULT_DESIGN_SYSTEM,
      slides: [slide],
    };
    const system = testDesignSystem({
      visualStyle: "dark-tech",
      colorScheme: "tech-dark",
    });
    const result = executeCommand(presentation, {
      id: "set-design",
      type: "set-design-system",
      designSystem: system,
    }).presentation;
    expect(result.designSystem).toEqual(system);
    expect(result.slides[0].visualSource).toEqual(slide.visualSource);
  });

  it("resolves image treatment independently from renderers", () => {
    const treatment = resolveImageTreatment("framed", "plain", 0, {
      cardBg: "#fff",
      cardStroke: "#ddd",
    });
    expect(treatment.padding).toBe(8);
    expect(treatment.borderColor).toBe("#ddd");
  });

  it("scores SVG-native slides with high baseline quality", () => {
    const result = evaluateDeckVisualQuality(DEFAULT_DESIGN_SYSTEM, [slide]);
    expect(result.scores.overall).toBeGreaterThanOrEqual(85);
    expect(result.slides[0].issues).toEqual([]);
  });

  it("warns when an SVG page is missing its narrative contract", () => {
    const result = evaluateDeckVisualQuality(DEFAULT_DESIGN_SYSTEM, [
      createSvgTestSlide({ id: "missing-narrative", title: "No narrative" }),
    ]);
    expect(result.slides[0].issues).toEqual([
      expect.objectContaining({ code: "missing-narrative", severity: "warning" }),
    ]);
  });

  it("does not award an empty deck a perfect score", () => {
    const result = evaluateDeckVisualQuality(DEFAULT_DESIGN_SYSTEM, []);
    expect(result.scores.overall).toBe(0);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "empty-deck", severity: "error" })]),
    );
  });

  it("penalizes non-SVG slides during visual evaluation", () => {
    const result = evaluateDeckVisualQuality(DEFAULT_DESIGN_SYSTEM, [
      {
        id: "legacy-slide",
        title: "Legacy",
        visualSource: undefined,
      } as unknown as Slide,
    ]);
    expect(result.slides[0].scores.overall).toBeLessThan(50);
    expect(result.slides[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "non-svg-slide", severity: "error" }),
      ]),
    );
  });
});
