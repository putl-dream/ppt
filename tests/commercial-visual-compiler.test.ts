import { describe, expect, it } from "vitest";

import {
  directCommercialDeck,
  compileCommercialDeck,
  evaluateCommercialQuality,
  type DirectedDeckPlanV1,
  type ResolvedAssetManifestV1,
} from "../src/shared/commercial-visual";
import type { LeanDeckSpecV2 } from "../src/shared/lean/deck-spec-v2";
import { createStarterPresentation } from "../src/shared/presentation";
import { pruneEmptyLayoutCards } from "../src/shared/layout-shape-utils";

const score = {
  total: 0,
  roleMatch: 0,
  purposeMatch: 0,
  compositionMatch: 0,
  contentFit: 0,
  rhythmBonus: 0,
  repetitionPenalty: 0,
};

function fixture(): {
  spec: LeanDeckSpecV2;
  plan: DirectedDeckPlanV1;
  assets: ResolvedAssetManifestV1;
} {
  const spec: LeanDeckSpecV2 = {
    version: 2,
    title: "Commercial compiler regression",
    locale: "en-US",
    scenario: "internal-report",
    audience: "Executive team",
    objective: "Verify semantic scene compilation",
    desiredAction: "Approve the next phase",
    coreMessage: "A deterministic compiler can preserve commercial meaning and editability",
    presentationContext: "Executive regression review",
    afterUse: "Approve the next compiler phase",
    restructurePermission: "reorder",
    narrativeMode: "evidence-led",
    durationMinutes: 10,
    designPreset: "report",
    sources: [{
      id: "report",
      label: "Digital transformation report",
      asOf: "2026",
      provenance: "user",
    }],
    slides: [
      {
        kind: "cover",
        purpose: "opening",
        title: "A sharper operating model",
        subtitle: "Commercial visual compiler v2",
        items: [],
        left: null,
        right: null,
        steps: [],
        metric: null,
        chart: null,
        sourceRefs: [],
        audienceMove: "Establish the promise of a sharper operating model",
        visual: {
          role: "hero",
          composition: "minimal-statement",
          imageMode: "none",
          assetBrief: "",
          emphasis: ["A sharper operating model"],
        },
      },
      {
        kind: "agenda",
        purpose: "navigation",
        title: "Three decisions",
        subtitle: "关键指标全面达成预期",
        items: [
          { heading: "Why now", detail: "" },
          { heading: "What changes", detail: "" },
          { heading: "How to start", detail: "" },
        ],
        left: null,
        right: null,
        steps: [],
        metric: null,
        chart: null,
        sourceRefs: [],
        audienceMove: "Orient the audience around three decisions",
        visual: {
          role: "overview",
          composition: "editorial-grid",
          imageMode: "none",
          assetBrief: "",
          emphasis: ["Three decisions"],
        },
      },
      {
        kind: "bullets",
        purpose: "context",
        title: "Evidence from the field",
        subtitle: "The operating model is already changing",
        items: [
          { heading: "Faster handoffs", detail: "Teams share one operating rhythm" },
          { heading: "Clear ownership", detail: "Decisions stay close to the work" },
        ],
        left: null,
        right: null,
        steps: [],
        metric: null,
        chart: null,
        sourceRefs: [],
        audienceMove: "Make the operating problem concrete",
        visual: {
          role: "evidence",
          composition: "split",
          imageMode: "optional",
          assetBrief: "Executive workshop in a modern operations room",
          emphasis: ["Faster handoffs"],
        },
      },
      {
        kind: "metric",
        purpose: "proof",
        title: "Efficiency compounds",
        subtitle: "数字化改造后效率提升明显",
        items: [],
        left: null,
        right: null,
        steps: [],
        metric: {
          value: "42%",
          label: "less cycle time",
          takeaway: "Digitized workflows remove repeated coordination",
        },
        chart: null,
        sourceRefs: ["report"],
        audienceMove: "Build confidence with a measurable outcome",
        visual: {
          role: "evidence",
          composition: "metric-story",
          imageMode: "none",
          assetBrief: "",
          emphasis: ["42%"],
        },
      },
      {
        kind: "chart",
        purpose: "insight",
        title: "Adoption rises by quarter",
        subtitle: "投资回报预测",
        items: [],
        left: null,
        right: null,
        steps: [],
        metric: null,
        chart: {
          chartType: "bar",
          unit: "%",
          items: [
            { label: "Q1", value: 24 },
            { label: "Q2", value: 39 },
            { label: "Q3", value: 58 },
          ],
          takeaway: "Adoption accelerates after the operating model stabilizes",
        },
        sourceRefs: ["report"],
        audienceMove: "Show the trend that supports the recommendation",
        visual: {
          role: "evidence",
          composition: "metric-story",
          imageMode: "none",
          assetBrief: "",
          emphasis: ["Adoption accelerates"],
        },
      },
      {
        kind: "process",
        purpose: "plan",
        title: "Move in three steps",
        subtitle: "分三步推进深度数字化",
        items: [],
        left: null,
        right: null,
        steps: [
          { heading: "Focus", detail: "Choose one workflow" },
          { heading: "Pilot", detail: "Run for 30 days" },
          { heading: "Scale", detail: "Expand what works" },
        ],
        metric: null,
        chart: null,
        sourceRefs: [],
        audienceMove: "Make the implementation path feel executable",
        visual: {
          role: "process",
          composition: "editorial-grid",
          imageMode: "none",
          assetBrief: "",
          emphasis: ["Move in three steps"],
        },
      },
      {
        kind: "closing",
        purpose: "close",
        title: "Start with one workflow",
        subtitle: "Prove the rhythm, then scale it",
        items: [{ heading: "Approve a 30-day pilot", detail: "" }],
        left: null,
        right: null,
        steps: [],
        metric: null,
        chart: null,
        sourceRefs: [],
        audienceMove: "Secure approval for the next phase",
        visual: {
          role: "statement",
          composition: "minimal-statement",
          imageMode: "none",
          assetBrief: "",
          emphasis: ["Start with one workflow"],
        },
      },
    ],
  };

  const selections = [
    ["cinematic-cover", "dark-title", "dark"],
    ["numbered-overview", "numbered-list", "light"],
    ["split-case", "image-sidebar", "light"],
    ["metric-landscape", "metric-focus", "dark"],
    ["metric-landscape", "chart-focus", "dark"],
    ["numbered-overview", "numbered-list", "light"],
    ["minimal-epilogue", "closing-statement", "dark"],
  ] as const;
  const plan: DirectedDeckPlanV1 = {
    version: 1,
    packId: "editorial-business",
    compilerVersion: "test-v2",
    slides: selections.map(([sceneId, variantId, backgroundMode], slideIndex) => ({
      slideIndex,
      sceneId,
      variantId,
      backgroundMode,
      emphasis: spec.slides[slideIndex]!.visual.emphasis,
      assetRequests: slideIndex === 2
        ? [{
            requestId: "field-image",
            slideIndex,
            slotId: "side",
            brief: spec.slides[slideIndex]!.visual.assetBrief,
            required: false,
            targetAspectRatio: 4 / 5,
          }]
        : [],
      fallbackSceneId: sceneId,
      fallbackVariantId: variantId,
      fallbackApplied: false,
      unresolvedRequiredRequestIds: [],
      score,
      rationaleCodes: [],
    })),
  };
  const assets: ResolvedAssetManifestV1 = {
    version: 1,
    assets: [{
      requestId: "field-image",
      slotId: "side",
      status: "resolved",
      sha256: "b".repeat(64),
      localPath: "assets/field-image.png",
      renderUrl: "assets/field-image.png",
      mimeType: "image/png",
      pixelWidth: 1500,
      pixelHeight: 1000,
      licenseStatus: "verified",
      rejectionCodes: [],
    }],
  };
  return { spec, plan, assets };
}

describe("commercial visual compiler", () => {
  it("directs section slides to a divider layout that keeps their title visible", () => {
    const { spec } = fixture();
    const sectionSlide: LeanDeckSpecV2["slides"][number] = {
      kind: "section",
      purpose: "navigation",
      title: "Market context",
      subtitle: "",
      items: [],
      left: null,
      right: null,
      steps: [],
      metric: null,
      chart: null,
      sourceRefs: [],
      audienceMove: "Signal a clear transition in the narrative",
      visual: {
        role: "statement",
        composition: "minimal-statement",
        imageMode: "none",
        assetBrief: "",
        emphasis: ["Market context"],
      },
    };
    const sectionSpec = {
      ...spec,
      slides: [...spec.slides.slice(0, -1), sectionSlide, spec.slides.at(-1)!],
    };
    const directed = directCommercialDeck({
      spec: sectionSpec,
      compilerVersion: "test-v2",
    });
    const sectionIndex = sectionSpec.slides.length - 2;
    const sectionPlan = directed.slides[sectionIndex]!;

    expect(sectionPlan.sceneId).toBe("hero-narrative");
    expect(sectionPlan.variantId).toBe("section-divider");

    const compiled = compileCommercialDeck({
      spec: sectionSpec,
      plan: directed,
      assets: { version: 1, assets: [] },
      basePresentation: createStarterPresentation(),
      compilerVersion: "test-v2",
    });
    const compiledSection = compiled.presentation.slides[sectionIndex]!;
    expect(compiledSection.layout).toBe("section");
    expect(compiledSection.elements.length).toBeGreaterThan(0);
    expect(compiledSection.elements.some(
      (element) => element.type === "text" && element.text === "Market context",
    )).toBe(true);
  });

  it("prunes unused layout cards while retaining populated cards", () => {
    const elements = pruneEmptyLayoutCards([
      {
        id: "empty-card",
        type: "shape",
        provenance: "layout",
        shapeType: "roundedRect",
        x: 120,
        y: 188,
        width: 400,
        height: 300,
        fillColor: "#fff",
        strokeColor: "#ddd",
      },
      {
        id: "populated-card",
        type: "shape",
        provenance: "layout",
        shapeType: "roundedRect",
        x: 600,
        y: 188,
        width: 400,
        height: 300,
        fillColor: "#fff",
        strokeColor: "#ddd",
      },
      {
        id: "populated-card-text",
        type: "text",
        x: 620,
        y: 430,
        width: 360,
        height: 40,
        text: "Content near the lower edge",
        fontSize: 18,
      },
    ]);

    expect(elements.map((element) => element.id)).toEqual([
      "populated-card",
      "populated-card-text",
    ]);
  });

  it("consumes semantic metric, asset, chart and source slots without overlap", () => {
    const { spec, plan, assets } = fixture();
    const compiled = compileCommercialDeck({
      spec,
      plan,
      assets,
      basePresentation: createStarterPresentation(),
      compilerVersion: "test-v2",
    });

    const evidenceImage = compiled.presentation.slides[2]!.elements.find(
      (element) => element.type === "image" && element.imageSlot === "side",
    );
    expect(evidenceImage?.type === "image" ? evidenceImage.width : 0).toBeGreaterThan(600);
    expect(evidenceImage?.type === "image" ? evidenceImage.asset?.licenseStatus : undefined)
      .toBe("verified");

    const metric = compiled.presentation.slides[3]!.elements.find(
      (element) => element.type === "text" && element.textRole === "metric",
    );
    const metricSource = compiled.presentation.slides[3]!.elements.find(
      (element) => element.type === "text" && element.textRole === "caption",
    );
    expect(metric?.type === "text" ? metric.text : "").toContain("42%");
    expect(metricSource?.type === "text" ? metricSource.text : "")
      .toContain("Digital transformation report");

    const chartSlide = compiled.presentation.slides[4]!;
    expect(chartSlide.speakerNotes).toBe(spec.slides[4]!.audienceMove);
    const chart = chartSlide.elements.find((element) => element.type === "chart");
    const chartSource = chartSlide.elements.find(
      (element) => element.type === "text" && element.textRole === "caption",
    );
    expect(chart?.type).toBe("chart");
    expect(chartSource?.type).toBe("text");
    if (chart?.type === "chart" && chartSource?.type === "text") {
      expect(chart.y + chart.height).toBeLessThanOrEqual(chartSource.y);
    }

    for (const slide of spec.slides) {
      if (!slide.subtitle) continue;
      const compiledSlide = compiled.presentation.slides.find(
        (candidate) => candidate.title === slide.title,
      );
      const visibleText = compiledSlide?.elements
        .filter((element) => element.type === "text")
        .map((element) => element.text)
        .join("\n") ?? "";
      expect(visibleText).toContain(slide.subtitle);
    }

    const quality = evaluateCommercialQuality({
      spec,
      plan,
      assets,
      presentation: compiled.presentation,
      canonicalHash: compiled.canonicalHash,
      determinismVerified: true,
      commandReplayVerified: true,
    });
    expect(quality.hardFailures).toEqual([]);
    expect(quality.passed).toBe(true);
  });
});
