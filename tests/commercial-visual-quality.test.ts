import { describe, expect, it } from "vitest";

import {
  EMPTY_ASSET_MANIFEST,
  evaluateCommercialQuality,
  type DirectedDeckPlanV1,
} from "../src/shared/commercial-visual";
import type { LeanDeckSpecV2 } from "../src/shared/lean/deck-spec-v2";
import { createStarterPresentation } from "../src/shared/presentation";

describe("commercial visual quality gate", () => {
  it("reports scene rhythm preferences as warnings instead of rejecting a valid deck", () => {
    const base = createStarterPresentation();
    const firstSlide = {
      ...base.slides[0]!,
      id: "quality-slide-1",
      sceneRef: {
        packId: "editorial-business",
        sceneId: "split-case",
        variantId: "fact-sidebar",
      },
    };
    const presentation = {
      ...base,
      slides: [
        firstSlide,
        { ...firstSlide, id: "quality-slide-2" },
      ],
    };
    const contentSlide = (_title: string): LeanDeckSpecV2["slides"][number] => ({
      kind: "bullets",
      purpose: "insight",
      title: "Opening",
      subtitle: "",
      items: [
        { heading: "Agent PPT", detail: "" },
      ],
      left: null,
      right: null,
      steps: [],
      metric: null,
      chart: null,
      sourceRefs: [],
      visual: {
        role: "statement",
        composition: "editorial-grid",
        imageMode: "none",
        assetBrief: "",
        emphasis: ["Opening"],
      },
    });
    const spec: LeanDeckSpecV2 = {
      version: 2,
      title: "质量门测试",
      locale: "zh-CN",
      scenario: "internal-report",
      audience: "管理层",
      objective: "验证质量门级别",
      desiredAction: "继续生成",
      durationMinutes: 10,
      designPreset: "business",
      sources: [],
      slides: [contentSlide("第一页"), contentSlide("第二页")],
    };
    const planSlide = (slideIndex: number): DirectedDeckPlanV1["slides"][number] => ({
      slideIndex,
      sceneId: "split-case",
      variantId: "fact-sidebar",
      backgroundMode: "light",
      emphasis: [spec.slides[slideIndex]!.title],
      assetRequests: [],
      fallbackSceneId: "split-case",
      fallbackVariantId: "fact-sidebar",
      fallbackApplied: false,
      unresolvedRequiredRequestIds: [],
      score: {
        total: 0,
        roleMatch: 0,
        purposeMatch: 0,
        compositionMatch: 0,
        contentFit: 0,
        rhythmBonus: 0,
        repetitionPenalty: 0,
      },
      rationaleCodes: [],
    });
    const plan: DirectedDeckPlanV1 = {
      version: 1,
      packId: "editorial-business",
      compilerVersion: "test",
      slides: [planSlide(0), planSlide(1)],
    };

    const quality = evaluateCommercialQuality({
      spec,
      plan,
      assets: EMPTY_ASSET_MANIFEST,
      presentation,
      canonicalHash: "test",
      determinismVerified: true,
      commandReplayVerified: true,
    });

    expect(quality.passed).toBe(true);
    expect(quality.hardFailures).toEqual([]);
    expect(quality.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "scene-variety-insufficient",
        "adjacent-scene-repeat",
      ]),
    );

    const missingContent = evaluateCommercialQuality({
      spec,
      plan,
      assets: EMPTY_ASSET_MANIFEST,
      presentation: {
        ...presentation,
        slides: [
          { ...presentation.slides[0]!, elements: [] },
          presentation.slides[1]!,
        ],
      },
      canonicalHash: "missing-content",
      determinismVerified: true,
      commandReplayVerified: true,
    });
    expect(missingContent.hardFailures.map((failure) => failure.code))
      .toContain("content-unit-unconsumed");

    const overlapPresentation = structuredClone(presentation);
    overlapPresentation.slides[0]!.elements.push(
      {
        id: "overlap-a",
        type: "text",
        x: 900,
        y: 100,
        width: 200,
        height: 80,
        text: "A",
        fontSize: 20,
      },
      {
        id: "overlap-b",
        type: "text",
        x: 920,
        y: 120,
        width: 200,
        height: 80,
        text: "B",
        fontSize: 20,
      },
    );
    const overlapQuality = evaluateCommercialQuality({
      spec,
      plan,
      assets: EMPTY_ASSET_MANIFEST,
      presentation: overlapPresentation,
      canonicalHash: "overlap",
      determinismVerified: true,
      commandReplayVerified: true,
    });
    expect(overlapQuality.hardFailures.map((failure) => failure.code))
      .toContain("foreground-overlap");
    expect(overlapQuality.scores.composition).toBeLessThan(100);

    const mediaOverlapPresentation = structuredClone(presentation);
    mediaOverlapPresentation.slides[0]!.elements.push(
      {
        id: "media-overlap-text",
        type: "text",
        x: 900,
        y: 100,
        width: 200,
        height: 80,
        text: "Caption",
        fontSize: 20,
      },
      {
        id: "media-overlap-image",
        type: "image",
        x: 920,
        y: 120,
        width: 200,
        height: 80,
        url: "assets/media-overlap.png",
        borderRadius: 0,
      },
    );
    const mediaOverlapQuality = evaluateCommercialQuality({
      spec,
      plan,
      assets: EMPTY_ASSET_MANIFEST,
      presentation: mediaOverlapPresentation,
      canonicalHash: "media-overlap",
      determinismVerified: true,
      commandReplayVerified: true,
    });
    expect(mediaOverlapQuality.hardFailures.map((failure) => failure.code))
      .not.toContain("foreground-overlap");
    expect(mediaOverlapQuality.warnings.map((warning) => warning.code))
      .toContain("foreground-media-overlap");
    expect(mediaOverlapQuality.hardFailures).toEqual([]);
    expect(mediaOverlapQuality.passed).toBe(true);
    expect(mediaOverlapQuality.scores.composition).toBeLessThan(100);

    const emptyCardPresentation = structuredClone(presentation);
    emptyCardPresentation.slides[0]!.elements.push({
      id: "empty-card",
      type: "shape",
      provenance: "layout",
      shapeType: "roundedRect",
      x: 900,
      y: 500,
      width: 250,
      height: 160,
      fillColor: "#ffffff",
      strokeColor: "#dbeafe",
    });
    const emptyCardQuality = evaluateCommercialQuality({
      spec,
      plan,
      assets: EMPTY_ASSET_MANIFEST,
      presentation: emptyCardPresentation,
      canonicalHash: "empty-card",
      determinismVerified: true,
      commandReplayVerified: true,
    });
    expect(emptyCardQuality.hardFailures.map((failure) => failure.code))
      .toContain("empty-layout-card");

    const assetPlan = structuredClone(plan);
    assetPlan.slides[0]!.assetRequests.push({
      requestId: "asset-1",
      slideIndex: 0,
      slotId: "side",
      brief: "Business evidence",
      required: false,
      targetAspectRatio: 4 / 5,
    });
    const assetQuality = evaluateCommercialQuality({
      spec,
      plan: assetPlan,
      assets: {
        version: 1,
        assets: [{
          requestId: "asset-1",
          slotId: "side",
          status: "resolved",
          sha256: "a".repeat(64),
          localPath: "assets/evidence.png",
          mimeType: "image/png",
          licenseStatus: "verified",
          rejectionCodes: [],
        }],
      },
      presentation,
      canonicalHash: "asset-slot",
      determinismVerified: true,
      commandReplayVerified: true,
    });
    expect(assetQuality.hardFailures.map((failure) => failure.code))
      .toContain("resolved-asset-slot-unconsumed");
  });
});
