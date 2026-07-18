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
    const contentSlide = (title: string): LeanDeckSpecV2["slides"][number] => ({
      kind: "bullets",
      purpose: "insight",
      title,
      subtitle: "",
      items: [
        { heading: "系统", detail: "完成统一" },
        { heading: "数据", detail: "实现互通" },
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
        emphasis: [title],
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
  });
});
