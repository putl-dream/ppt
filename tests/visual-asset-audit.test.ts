import { describe, expect, it } from "vitest";
import { auditPresentationVisualAssets } from "../src/shared/visual-asset-audit";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

describe("visual asset audit", () => {
  it("reports missing image-dependent slides and duplicate image reuse", () => {
    const duplicateUrl = "https://images.example.com/reused.jpg";
    const audit = auditPresentationVisualAssets({
      id: "deck",
      title: "Visual deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [
        {
          id: "cover",
          title: "Opening",
          layout: "cover",
          grammarVariant: "editorial-hero",
          elements: [],
        },
        {
          id: "evidence",
          title: "Field evidence",
          layout: "case",
          grammarVariant: "evidence",
          elements: [],
        },
        {
          id: "a",
          title: "A",
          layout: "concept",
          elements: [{ id: "i1", type: "image", x: 0, y: 0, width: 100, height: 100, url: duplicateUrl, borderRadius: 0 }],
        },
        {
          id: "b",
          title: "B",
          layout: "concept",
          elements: [{ id: "i2", type: "image", x: 0, y: 0, width: 100, height: 100, url: duplicateUrl, borderRadius: 0 }],
        },
      ],
    });

    expect(audit.missingRequiredCount).toBe(1);
    expect(audit.missingRecommendedCount).toBe(1);
    expect(audit.slides.find((slide) => slide.slideId === "evidence")).toMatchObject({
      status: "missing-required",
      suggestedSlot: "side",
    });
    expect(audit.duplicateImageUrls).toEqual([duplicateUrl]);
    expect(audit.nextAction).toContain("SearchSlideImages");
  });
});
