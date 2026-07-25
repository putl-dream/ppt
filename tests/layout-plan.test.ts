import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildLayoutPlanCommands,
  getSelectedDesignDirection,
  parseLayoutPlan,
  serializeLayoutPlan,
  validateLayoutPlan,
  validateLayoutPlanAgainstPresentation,
  validateLayoutPlanRhythm,
  type LayoutPlan,
  type LayoutPlanSlide,
} from "../src/shared/layout-plan";

const COMMUNICATION_CONTRACT: LayoutPlan["communicationContract"] = {
  audience: "Product and engineering leaders",
  objective: "Align the team on the next technology investment.",
  desiredOutcome: "Approve the recommended roadmap and its first milestone.",
  coreMessage: "A staged platform investment creates value sooner with less delivery risk.",
  deliveryContext: "A 15-minute executive review.",
  afterUse: "The audience can choose a direction and assign the first owner.",
};

const SAFE_DESIGN_SYSTEM: LayoutPlan["directions"][number]["designSystem"] = {
  version: 2,
  argumentMode: "briefing",
  visualStyle: "swiss-minimal",
  colorScheme: "business-blue",
  readingMode: "balanced",
};

const SHIFTED_DESIGN_SYSTEM: LayoutPlan["directions"][number]["designSystem"] = {
  version: 2,
  argumentMode: "briefing",
  visualStyle: "editorial",
  colorScheme: "warm-paper",
  readingMode: "balanced",
};

const BOLD_DESIGN_SYSTEM: LayoutPlan["directions"][number]["designSystem"] = {
  version: 2,
  argumentMode: "briefing",
  visualStyle: "dark-tech",
  colorScheme: "tech-dark",
  readingMode: "balanced",
};

const RECOMMENDED_DIRECTIONS: LayoutPlan["directions"] = [
  {
    id: "safe",
    tier: "safe",
    label: "Clear baseline",
    rationale: "A restrained executive system optimized for immediate comprehension.",
    designSystem: SAFE_DESIGN_SYSTEM,
  },
  {
    id: "shifted",
    tier: "shifted",
    label: "Editorial analysis",
    rationale: "Adds a stronger editorial voice while preserving document readability.",
    designSystem: SHIFTED_DESIGN_SYSTEM,
  },
  {
    id: "bold",
    tier: "bold",
    label: "Technical signal",
    rationale: "A high-contrast visual language for a more memorable live presentation.",
    designSystem: BOLD_DESIGN_SYSTEM,
  },
];

function createSlide(overrides: Partial<LayoutPlanSlide> = {}): LayoutPlanSlide {
  return {
    slideId: "slide-1",
    title: "Cover",
    narrativeRole: "cover",
    audienceMove: "Recognize the decision that this presentation must unlock.",
    rhythm: "anchor",
    layoutIntent: "Open with one decisive statement and a restrained visual hierarchy.",
    layout: "cover",
    grammarVariant: "centered",
    slideVariant: "hero",
    rationale: "Opening page.",
    enhancements: [],
    ...overrides,
  };
}

function createRecommendedPlan(
  slides: LayoutPlanSlide[] = [createSlide()],
  selectedDirectionId = "shifted",
): LayoutPlan {
  return {
    version: 2,
    communicationContract: { ...COMMUNICATION_CONTRACT },
    selectionSource: "recommended-spectrum",
    directions: RECOMMENDED_DIRECTIONS.map((direction) => ({
      ...direction,
      designSystem: { ...direction.designSystem },
    })),
    selectedDirectionId,
    designNotes: "Use a clear argument with deliberate shifts in page rhythm.",
    slides,
  };
}

describe("layout-plan", () => {
  it("parses and serializes the v2 communication, direction, and slide intent contract", () => {
    const plan = parseLayoutPlan(JSON.stringify(createRecommendedPlan([
      createSlide({
        grammarVariant: "editorial-hero",
        audienceMove: "See the roadmap as one consequential executive decision.",
        rhythm: "anchor",
        layoutIntent: "Pair the core claim with one editorial visual anchor.",
      }),
    ])));

    expect(plan.version).toBe(2);
    expect(plan.communicationContract).toEqual(COMMUNICATION_CONTRACT);
    expect(plan.selectionSource).toBe("recommended-spectrum");
    expect(plan.directions.map((direction) => direction.tier)).toEqual([
      "safe",
      "shifted",
      "bold",
    ]);
    expect(plan.selectedDirectionId).toBe("shifted");
    expect(getSelectedDesignDirection(plan).designSystem).toEqual(SHIFTED_DESIGN_SYSTEM);
    expect(plan.slides[0]).toMatchObject({
      audienceMove: "See the roadmap as one consequential executive decision.",
      rhythm: "anchor",
      layoutIntent: "Pair the core claim with one editorial visual anchor.",
      grammarVariant: "editorial-hero",
    });

    const serialized = serializeLayoutPlan(plan);
    expect(serialized).toContain('"version": 2');
    expect(serialized).toContain('"communicationContract"');
    expect(serialized).toContain('"audienceMove"');
  });

  it("requires a complete safe, shifted, and bold recommendation spectrum", () => {
    const incomplete = createRecommendedPlan();
    incomplete.directions = incomplete.directions.slice(0, 2);

    expect(() => parseLayoutPlan(JSON.stringify(incomplete))).toThrow(
      /safe, shifted, and bold/,
    );
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
    expect(plan.communicationContract.coreMessage).toContain("技术演进");
    expect(plan.directions.map((direction) => direction.tier)).toEqual([
      "safe",
      "shifted",
      "bold",
    ]);
    expect(plan.selectedDirectionId).toBe("shifted");
    expect(plan.slides.every((slide) =>
      slide.audienceMove.length > 0
      && slide.layoutIntent.length > 0
      && ["anchor", "dense", "breathing"].includes(slide.rhythm))).toBe(true);
    expect(new Set(plan.slides.map((slide) => slide.layout)).size).toBeGreaterThanOrEqual(5);
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(rhythmIssues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("flags three consecutive same layouts", () => {
    const plan = parseLayoutPlan(JSON.stringify(createRecommendedPlan([
      createSlide({
        slideId: "s1",
        title: "A",
        narrativeRole: "content",
        audienceMove: "Understand the first concept.",
        rhythm: "dense",
        layoutIntent: "Introduce the concept with a single visual hierarchy.",
        layout: "concept",
        grammarVariant: "cards",
        slideVariant: undefined,
        rationale: "a",
      }),
      createSlide({
        slideId: "s2",
        title: "B",
        narrativeRole: "content",
        audienceMove: "Connect the second concept to the first.",
        rhythm: "dense",
        layoutIntent: "Add supporting detail in a compact card system.",
        layout: "concept",
        grammarVariant: "cards",
        slideVariant: undefined,
        rationale: "b",
      }),
      createSlide({
        slideId: "s3",
        title: "C",
        narrativeRole: "content",
        audienceMove: "Conclude the concept sequence.",
        rhythm: "dense",
        layoutIntent: "Pause on the final implication.",
        layout: "concept",
        grammarVariant: "cards",
        slideVariant: undefined,
        rationale: "c",
      }),
    ])));

    const issues = validateLayoutPlan(plan);
    expect(issues.some((issue) =>
      issue.severity === "error" && issue.message.includes("consecutive"))).toBe(true);
  });

  it("rejects grammar variants that are unsupported by the selected layout", () => {
    const plan = parseLayoutPlan(JSON.stringify(createRecommendedPlan([
      createSlide({
        slideId: "s1",
        title: "Process",
        narrativeRole: "content",
        audienceMove: "Understand how the stages connect.",
        rhythm: "dense",
        layoutIntent: "Show an ordered flow with visible hand-offs.",
        layout: "process",
        grammarVariant: "invented-layout",
        slideVariant: undefined,
        rationale: "Invalid on purpose.",
      }),
    ])));

    const issues = validateLayoutPlan(plan);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        slideId: "s1",
        message: expect.stringContaining("not supported"),
      }),
    ]));
  });

  it("builds commands with only the selected design direction", () => {
    const plan = parseLayoutPlan(JSON.stringify(createRecommendedPlan([
      createSlide({
        grammarVariant: "signal-dark",
        layoutIntent: "Use a high-contrast opening signal.",
      }),
    ], "bold")));

    const commands = buildLayoutPlanCommands(plan);
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "set-design-system",
          designSystem: BOLD_DESIGN_SYSTEM,
        }),
        expect.objectContaining({
          type: "update-slide-layout",
          slideId: "slide-1",
          layout: "cover",
          grammarVariant: "signal-dark",
        }),
        expect.objectContaining({
          type: "update-slide-variant",
          slideId: "slide-1",
          slideVariant: "hero",
        }),
      ]),
    );
    expect(commands).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "set-design-system",
        designSystem: SAFE_DESIGN_SYSTEM,
      }),
    ]));
    expect(commands).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "set-design-system",
        designSystem: SHIFTED_DESIGN_SYSTEM,
      }),
    ]));
  });

  it("rejects image-dependent layouts without existing or planned images", () => {
    const plan = parseLayoutPlan(JSON.stringify(createRecommendedPlan([
      createSlide({
        title: "Evidence",
        narrativeRole: "data",
        audienceMove: "Trust the recommendation because the evidence is concrete.",
        rhythm: "anchor",
        layoutIntent: "Make one proof point and its supporting visual inseparable.",
        layout: "case",
        grammarVariant: "evidence",
        slideVariant: undefined,
        rationale: "Evidence-led case study.",
      }),
    ])));
    const presentation = {
      id: "deck",
      title: "Deck",
      revision: 1,
      designSystem: SHIFTED_DESIGN_SYSTEM,
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
    const plan = parseLayoutPlan(JSON.stringify(createRecommendedPlan([
      createSlide({
        title: "Summary",
        narrativeRole: "summary",
        audienceMove: "Commit to the next action.",
        rhythm: "breathing",
        layoutIntent: "Close with a short action list and generous whitespace.",
        layout: "summary",
        grammarVariant: undefined,
        slideVariant: undefined,
        rationale: "Closing page.",
        enhancements: [{
          type: "insert-image",
          slot: "hero",
          url: "https://example.com/image.jpg",
        }],
      }),
    ])));

    expect(validateLayoutPlan(plan)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("invalid for layout"),
      }),
    ]));
  });

  it("rejects non-executable layout-plan enhancements", () => {
    const invalidPlan = createRecommendedPlan();
    invalidPlan.slides[0] = {
      ...createSlide({
        title: "Metrics",
        narrativeRole: "data",
        audienceMove: "See the most important performance signal.",
        rhythm: "dense",
        layoutIntent: "Lead with one metric and concise supporting evidence.",
        layout: "case",
        grammarVariant: "metric-focus",
        slideVariant: undefined,
        rationale: "Metrics page.",
      }),
      enhancements: [{
        type: "insert-image",
        slot: "hero",
        url: "https://example.com/evidence.jpg",
      }],
    };
    const serialized = JSON.parse(JSON.stringify(invalidPlan)) as {
      slides: Array<Record<string, unknown>>;
    };
    serialized.slides[0].enhancements = [{
      type: "beautify-chart",
      chartType: "kpi-tower",
    }];

    expect(() => parseLayoutPlan(JSON.stringify(serialized))).toThrow();
  });
});
