import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LeanV2Pipeline,
  type CommercialAssetResolver,
} from "../src/main/agent/lean/lean-v2-pipeline";
import { evaluateCommercialQuality } from "../src/shared/commercial-visual";
import { leanDeckSpecV2Schema } from "../src/shared/lean/deck-spec-v2";
import { createStarterPresentation } from "../src/shared/presentation";

const noExternalAssets: CommercialAssetResolver = {
  async resolve(requests) {
    return {
      version: 1,
      assets: requests.map((request) => ({
        requestId: request.requestId,
        slotId: request.slotId,
        status: "unavailable" as const,
        licenseStatus: "unknown" as const,
        rejectionCodes: ["fixture-native-visuals"],
      })),
    };
  },
};

function createDeterministicStarterPresentation() {
  const presentation = createStarterPresentation();
  presentation.id = "commercial-fixture-presentation";
  presentation.slides[0]!.id = "commercial-fixture-opening";
  presentation.slides[0]!.elements[0]!.id = "commercial-fixture-title";
  return presentation;
}

describe("commercial PPT fixture", () => {
  it("compiles the fixed eight-slide deck deterministically through Lean v2", async () => {
    const fixturePath = resolve(
      process.cwd(),
      "tests",
      "fixtures",
      "commercial-visual-growth-os.json",
    );
    const spec = leanDeckSpecV2Schema.parse(
      JSON.parse(await readFile(fixturePath, "utf8")),
    );
    const pipeline = new LeanV2Pipeline(noExternalAssets);

    const first = await pipeline.create({
      spec,
      basePresentation: createDeterministicStarterPresentation(),
    });
    const second = await pipeline.create({
      spec,
      basePresentation: createDeterministicStarterPresentation(),
    });

    expect(first.presentation.slides).toHaveLength(8);
    expect(first.quality.passed).toBe(true);
    expect(first.quality.sceneStats.distinctScenes).toBeGreaterThanOrEqual(5);
    expect(first.quality.sceneStats.repeatedAdjacentScenes).toBe(0);
    expect(first.quality.sceneStats.strongVisualSlides).toBeGreaterThanOrEqual(4);
    expect(first.quality.scores.editability).toBe(100);
    expect(first.quality.scores.assetQuality).toBeNull();
    expect(first.quality.scoreDetails.assetQuality.status).toBe("not-applicable");
    expect(first.quality.humanReview.status).toBe("not-reviewed");
    expect(first.quality.sceneStats.cardWallSlides).toBeGreaterThan(0);
    expect(first.quality.scores.overall).toBeLessThan(90);
    expect(first.canonicalHash).toBe(second.canonicalHash);
    expect(first.presentation).toEqual(second.presentation);
    expect(first.commands).toEqual(second.commands);

    const repeatedPlan = structuredClone(first.plan);
    repeatedPlan.slides = repeatedPlan.slides.map((slide) => ({
      ...slide,
      sceneId: "split-case",
      variantId: "fact-sidebar",
    }));
    const repeatedPresentation = structuredClone(first.presentation);
    repeatedPresentation.slides = repeatedPresentation.slides.map((slide) => ({
      ...slide,
      sceneRef: {
        packId: "editorial-business",
        sceneId: "split-case",
        variantId: "fact-sidebar",
      },
    }));
    const rejected = evaluateCommercialQuality({
      spec,
      plan: repeatedPlan,
      assets: first.manifest,
      presentation: repeatedPresentation,
      canonicalHash: "deliberately-repetitive",
      determinismVerified: true,
      commandReplayVerified: true,
    });

    expect(rejected.passed).toBe(false);
    expect(rejected.hardFailures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        "scene-variety-insufficient",
        "adjacent-scene-repeat",
        "strong-visual-coverage-insufficient",
      ]),
    );
  });
});
