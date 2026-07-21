import { describe, expect, it } from "vitest";

import {
  applyCommercialAssetFallbacks,
  directCommercialDeck,
} from "../src/shared/commercial-visual/director";
import { EMPTY_ASSET_MANIFEST } from "../src/shared/commercial-visual/contracts";
import type { LeanDeckSpecV2 } from "../src/shared/lean/deck-spec-v2";

function closingWithRequiredImage(): LeanDeckSpecV2["slides"][number] {
  return {
    kind: "closing",
    purpose: "close",
    title: "长期主义带来持续领先",
    subtitle: "以持续迭代完成数字化转型",
    items: [{ heading: "立即行动", detail: "启动下一阶段能力建设" }],
    left: null,
    right: null,
    steps: [],
    metric: null,
    chart: null,
    sourceRefs: [],
    audienceMove: "推动受众确认下一步行动",
    visual: {
      role: "statement",
      composition: "minimal-statement",
      imageMode: "required",
      assetBrief: "体现长期增长与数字化能力建设的商业摄影",
      emphasis: ["长期主义", "持续领先"],
    },
  };
}

function comparisonSlide(title: string): LeanDeckSpecV2["slides"][number] {
  return {
    kind: "comparison",
    purpose: "insight",
    title,
    subtitle: "",
    items: [],
    left: { label: "过去", items: ["系统分散", "数据割裂"] },
    right: { label: "现在", items: ["系统协同", "数据互通"] },
    steps: [],
    metric: null,
    chart: null,
    sourceRefs: [],
    audienceMove: "让受众相信协同模式更有效",
    visual: {
      role: "comparison",
      composition: "split",
      imageMode: "none",
      assetBrief: "",
      emphasis: [title],
    },
  };
}

function specWithSlides(slides: LeanDeckSpecV2["slides"]): LeanDeckSpecV2 {
  return {
    version: 2,
    title: "数字化转型汇报",
    locale: "zh-CN",
    scenario: "internal-report",
    audience: "管理层",
    objective: "汇报数字化转型进展",
    desiredAction: "确认下一阶段行动",
    coreMessage: "用统一叙事推动管理层确认下一阶段",
    presentationContext: "管理层阶段汇报",
    afterUse: "用于会后行动跟进",
    restructurePermission: "reorder",
    narrativeMode: "executive-brief",
    durationMinutes: 10,
    designPreset: "business",
    sources: [],
    slides,
  };
}

describe("commercial visual director", () => {
  it("degrades required image intent when the slide scene has no image variant", () => {
    const spec = specWithSlides([closingWithRequiredImage()]);

    const plan = directCommercialDeck({
      spec,
      compilerVersion: "test",
    });

    expect(plan.slides[0]).toMatchObject({
      sceneId: "minimal-epilogue",
      variantId: "closing-statement",
      assetRequests: [],
      fallbackApplied: true,
      unresolvedRequiredRequestIds: [],
    });
    expect(plan.slides[0]?.rationaleCodes).toContain("image-intent-fallback");

    const resolvedPlan = applyCommercialAssetFallbacks({
      spec,
      plan,
      manifest: EMPTY_ASSET_MANIFEST,
    });
    expect(resolvedPlan.slides[0]).toMatchObject({
      fallbackApplied: true,
      assetRequests: [],
      unresolvedRequiredRequestIds: [],
    });
  });

  it("chooses an alternate compatible scene before repeating the previous scene", () => {
    const spec = specWithSlides([
      comparisonSlide("增长逻辑发生变化"),
      comparisonSlide("运营模式同步升级"),
    ]);

    const plan = directCommercialDeck({
      spec,
      compilerVersion: "test",
    });

    expect(plan.slides.map((slide) => slide.sceneId)).toEqual([
      "dual-evidence",
      "split-case",
    ]);
    expect(plan.slides[1]?.rationaleCodes).not.toContain("repetition-penalty");
  });
});
