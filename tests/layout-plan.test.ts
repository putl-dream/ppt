import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildLayoutPlanCommands,
  parseLayoutPlan,
  serializeLayoutPlan,
  validateLayoutPlan,
  validateLayoutPlanAgainstPresentation,
  validateLayoutPlanRhythm,
} from "../src/shared/layout-plan";
import { TEST_DESIGN_SYSTEM, testDesignSystem } from "./design-engine-test-utils";

describe("layout-plan", () => {
  it("parses and serializes a valid layout plan", () => {
    const plan = parseLayoutPlan(JSON.stringify({
      version: 1,
      styleMode: "template",
      designSystem: testDesignSystem({ palette: "warm-paper", fontMood: "editorial", shapeLanguage: "annotation", backgroundStyle: "paper", motif: "bookmark", density: "calm", imageTreatment: "framed" }),
      slides: [{
        slideId: "slide-1",
        title: "Cover",
        narrativeRole: "cover",
        layout: "cover",
        grammarVariant: "editorial-hero",
        slideVariant: "hero",
        rationale: "Opening page.",
        enhancements: [],
      }],
    }));

    expect(plan.designSystem.tokens.palette).toBe("warm-paper");
    expect(plan.slides[0].grammarVariant).toBe("editorial-hero");
    expect(serializeLayoutPlan(plan)).toContain('"layout": "cover"');
  });

  it("validates tech evolution fixture against Rubric", async () => {
    const raw = await readFile(
      join(__dirname, "fixtures", "layout-plan-tech-evolution.json"),
      "utf8",
    );
    const plan = parseLayoutPlan(raw);
    const issues = validateLayoutPlan(plan);
    const rhythmIssues = validateLayoutPlanRhythm(plan);

    expect(plan.slides).toHaveLength(8);
    expect(new Set(plan.slides.map((slide) => slide.layout)).size).toBeGreaterThanOrEqual(5);
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(rhythmIssues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("flags three consecutive same layouts", () => {
    const plan = parseLayoutPlan(JSON.stringify({
      version: 1,
      styleMode: "template",
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [
        {
          slideId: "s1",
          title: "A",
          narrativeRole: "content",
          layout: "concept",
          rationale: "a",
          enhancements: [],
        },
        {
          slideId: "s2",
          title: "B",
          narrativeRole: "content",
          layout: "concept",
          rationale: "b",
          enhancements: [],
        },
        {
          slideId: "s3",
          title: "C",
          narrativeRole: "content",
          layout: "concept",
          rationale: "c",
          enhancements: [],
        },
      ],
    }));

    const issues = validateLayoutPlan(plan);
    expect(issues.some((issue) => issue.severity === "error" && issue.message.includes("consecutive"))).toBe(true);
  });

  it("rejects grammar variants that are unsupported by the selected layout", () => {
    const plan = parseLayoutPlan(JSON.stringify({
      version: 1,
      styleMode: "template",
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{
        slideId: "s1",
        title: "Process",
        narrativeRole: "content",
        layout: "process",
        grammarVariant: "invented-layout",
        rationale: "Invalid on purpose.",
        enhancements: [],
      }],
    }));

    const issues = validateLayoutPlan(plan);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        slideId: "s1",
        message: expect.stringContaining("not supported"),
      }),
    ]));
  });

  it("builds set-design-system and update-slide-layout commands", () => {
    const plan = parseLayoutPlan(JSON.stringify({
      version: 1,
      styleMode: "template",
      designSystem: testDesignSystem({ palette: "tech-dark", fontMood: "technical", shapeLanguage: "geometric", backgroundStyle: "dark", motif: "arc", imageTreatment: "masked", chartStyle: "dashboard" }),
      slides: [{
        slideId: "slide-1",
        title: "Cover",
        narrativeRole: "cover",
        layout: "cover",
        grammarVariant: "signal-dark",
        slideVariant: "hero",
        rationale: "Opening.",
        enhancements: [],
      }],
    }));

    const commands = buildLayoutPlanCommands(plan);
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-design-system", designSystem: expect.objectContaining({ version: 1 }) }),
        expect.objectContaining({
          type: "update-slide-layout",
          slideId: "slide-1",
          layout: "cover",
          grammarVariant: "signal-dark",
        }),
        expect.objectContaining({ type: "update-slide-variant", slideId: "slide-1", slideVariant: "hero" }),
      ]),
    );
  });

  it("rejects image-dependent layouts without existing or planned images", () => {
    const plan = parseLayoutPlan(JSON.stringify({
      version: 1,
      styleMode: "template",
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{
        slideId: "slide-1",
        title: "Evidence",
        narrativeRole: "data",
        layout: "case",
        grammarVariant: "evidence",
        rationale: "Evidence-led case study.",
        enhancements: [],
      }],
    }));
    const presentation = {
      id: "deck",
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{ id: "slide-1", title: "Evidence", elements: [] }],
    };

    const issues = validateLayoutPlanAgainstPresentation(plan, presentation);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        slideId: "slide-1",
        message: expect.stringContaining("Image-dependent layout"),
      }),
    ]));
  });

  it("rejects insert-image slots that the selected layout cannot consume", () => {
    const plan = parseLayoutPlan(JSON.stringify({
      version: 1,
      styleMode: "template",
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{
        slideId: "slide-1",
        title: "Summary",
        narrativeRole: "summary",
        layout: "summary",
        rationale: "Closing page.",
        enhancements: [{
          type: "insert-image",
          slot: "hero",
          url: "https://example.com/image.jpg",
        }],
      }],
    }));

    expect(validateLayoutPlan(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("invalid for layout"),
      }),
    ]));
  });

  it("rejects non-executable layout-plan enhancements", () => {
    expect(() => parseLayoutPlan(JSON.stringify({
      version: 1,
      styleMode: "template",
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [{
        slideId: "slide-1",
        title: "Metrics",
        narrativeRole: "data",
        layout: "case",
        rationale: "Metrics page.",
        enhancements: [{
          type: "beautify-chart",
          chartType: "kpi-tower",
        }],
      }],
    }))).toThrow();
  });
});
