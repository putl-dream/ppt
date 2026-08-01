import { describe, expect, it } from "vitest";
import { createSvgTestSlide } from "../src/shared/presentation";
import { auditPresentationVisualAssets } from "../src/shared/visual-asset-audit";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

describe("visual asset audit", () => {
  it("reports duplicate SVG raster resources and satisfied slides with embedded assets", () => {
    const duplicatePath = "assets/shared-photo.png";
    const resource = {
      sourcePath: duplicatePath,
      mimeType: "image/png" as const,
      byteSize: 2048,
      sha256: "a".repeat(64),
    };
    const slideA = createSvgTestSlide({ id: "a", title: "A" });
    slideA.visualSource.resources = [resource];
    const slideB = createSvgTestSlide({ id: "b", title: "B" });
    slideB.visualSource.resources = [resource];
    const slideC = createSvgTestSlide({ id: "c", title: "C" });

    const audit = auditPresentationVisualAssets({
      id: "deck",
      title: "Visual deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [slideA, slideB, slideC],
    });

    expect(audit.missingRequiredCount).toBe(0);
    expect(audit.missingRecommendedCount).toBe(0);
    expect(audit.imageSlideCount).toBe(2);
    expect(audit.totalImageCount).toBe(2);
    expect(audit.duplicateImageUrls).toEqual([duplicatePath]);
    expect(audit.slides.find((slide) => slide.slideId === "a")).toMatchObject({
      status: "satisfied",
      existingImageCount: 1,
    });
    expect(audit.slides.find((slide) => slide.slideId === "c")).toMatchObject({
      status: "not-needed",
      existingImageCount: 0,
    });
    expect(audit.nextAction).toContain("Replace duplicate image URLs");
  });
});
