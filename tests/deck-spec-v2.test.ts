import { describe, expect, it } from "vitest";

import {
  leanSlideSpecV2Schema,
  type LeanSlideSpecV2,
} from "../src/shared/lean/deck-spec-v2";

function coverSlide(
  emphasis: string[],
  overrides: Partial<LeanSlideSpecV2> = {},
): LeanSlideSpecV2 {
  return {
    kind: "cover",
    purpose: "opening",
    title: "数字化转型阶段性汇报",
    subtitle: "从基础建设走向全面赋能",
    items: [],
    left: null,
    right: null,
    steps: [],
    metric: null,
    chart: null,
    sourceRefs: [],
    visual: {
      role: "hero",
      composition: "minimal-statement",
      imageMode: "none",
      assetBrief: "",
      emphasis,
    },
    ...overrides,
  };
}

describe("Lean DeckSpec v2 emphasis", () => {
  it("accepts verbatim phrases contained in visible slide text", () => {
    const parsed = leanSlideSpecV2Schema.safeParse(coverSlide([
      "数字化转型",
      "阶段性汇报",
      "全面赋能",
    ]));

    expect(parsed.success).toBe(true);
  });

  it("rejects emphasis that is not present in visible slide text", () => {
    const parsed = leanSlideSpecV2Schema.safeParse(coverSlide(["长期主义"]));

    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected absent emphasis to fail.");
    expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["visual", "emphasis", 0],
        message: "Emphasis '长期主义' must be copied from visible slide content.",
      }),
    ]));
  });

  it("recognizes visible chart labels, values, and units", () => {
    const parsed = leanSlideSpecV2Schema.safeParse(coverSlide(
      ["Q4", "120", "%"],
      {
        kind: "chart",
        purpose: "proof",
        title: "Q4 数据互通率超额完成",
        subtitle: "",
        chart: {
          chartType: "bar",
          unit: "%",
          items: [
            { label: "目标", value: 100 },
            { label: "实际", value: 120 },
          ],
          takeaway: "实际结果高于目标",
        },
        sourceRefs: ["internal"],
        visual: {
          role: "evidence",
          composition: "metric-story",
          imageMode: "none",
          assetBrief: "",
          emphasis: ["Q4", "120", "%"],
        },
      },
    ));

    expect(parsed.success).toBe(true);
  });
});
