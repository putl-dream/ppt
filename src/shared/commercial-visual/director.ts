import type { LeanDeckSpecV2, LeanSlideSpecV2 } from "../lean/deck-spec-v2";
import {
  directedDeckPlanV1Schema,
  type DirectedDeckPlanV1,
  type DirectedSlidePlanV1,
  type ResolvedAssetManifestV1,
} from "./contracts";
import {
  commercialSceneRegistry,
  type CommercialSceneDefinition,
} from "./scene-registry";

function scoreScene(
  scene: CommercialSceneDefinition,
  slide: LeanSlideSpecV2,
  backgroundMode: DirectedSlidePlanV1["backgroundMode"],
  previous?: DirectedSlidePlanV1,
): DirectedSlidePlanV1["score"] {
  const roleMatch = scene.supportedRoles.includes(slide.visual.role) ? 40 : 0;
  const purposeMatch = scene.supportedPurposes.includes(slide.purpose) ? 25 : 0;
  const compositionMatch = scene.supportedCompositions.includes(slide.visual.composition) ? 25 : 0;
  const contentFit =
    (scene.id === "project-gallery"
      && slide.visual.role === "gallery"
      && slide.visual.composition === "image-collage")
    || (scene.id === "dual-evidence" && slide.kind === "comparison")
    || (scene.id === "metric-landscape" && (slide.kind === "metric" || slide.kind === "chart"))
    || (scene.id === "numbered-overview" && (slide.kind === "agenda" || slide.kind === "process"))
    || (scene.id === "hero-narrative" && slide.kind === "section")
      ? 20
      : 0;
  const rhythmBonus = previous && previous.backgroundMode !== backgroundMode ? 5 : 0;
  const repetitionPenalty = previous?.sceneId === scene.id ? 30 : 0;
  return {
    total:
      roleMatch
      + purposeMatch
      + compositionMatch
      + contentFit
      + rhythmBonus
      - repetitionPenalty,
    roleMatch,
    purposeMatch,
    compositionMatch,
    contentFit,
    rhythmBonus,
    repetitionPenalty,
  };
}

function selectVariant(scene: CommercialSceneDefinition, slide: LeanSlideSpecV2) {
  if (scene.id === "hero-narrative" && slide.kind === "section") {
    return scene.variants.find((variant) => variant.id === "section-divider");
  }
  if (scene.id === "metric-landscape") {
    return scene.variants.find((variant) =>
      variant.id === (slide.kind === "chart" ? "chart-focus" : "metric-focus")
    );
  }
  if (slide.visual.imageMode === "none") {
    return scene.variants.find((variant) => variant.assetSlots.length === 0);
  }
  return scene.variants.find((variant) => variant.assetSlots.length > 0)
    ?? scene.variants.find((variant) => variant.assetSlots.length === 0);
}

export function directCommercialDeck(
  input: {
    spec: LeanDeckSpecV2;
    compilerVersion: string;
    manifest?: ResolvedAssetManifestV1;
  },
): DirectedDeckPlanV1 {
  const slides: DirectedSlidePlanV1[] = [];

  input.spec.slides.forEach((slide, slideIndex) => {
    const candidates = commercialSceneRegistry.getAll()
      .filter((scene) => scene.canPlan(slide))
      .flatMap((scene) => {
        const variant = selectVariant(scene, slide);
        return variant
          ? [{
              scene,
              variant,
              score: scoreScene(scene, slide, variant.backgroundMode, slides.at(-1)),
            }]
          : [];
      })
      .sort((left, right) =>
        right.score.total - left.score.total
        || left.scene.order - right.scene.order
      );
    const previousSceneId = slides.at(-1)?.sceneId;
    const selected = candidates.find((candidate) =>
      candidate.scene.id !== previousSceneId
    ) ?? candidates[0];
    if (!selected) {
      throw new Error(`No commercial scene can compile slide ${slideIndex + 1}.`);
    }
    const imageIntentFallback =
      slide.visual.imageMode !== "none"
      && selected.variant.assetSlots.length === 0;

    const assetRequests = selected.variant.assetSlots.map((slot) => ({
          requestId: `slide-${slideIndex}-${slot.id}`,
          slideIndex,
          slotId: slot.id,
          brief: slide.visual.assetBrief,
          required: slide.visual.imageMode === "required" || slot.required,
          targetAspectRatio: slot.targetAspectRatio,
        }));

    slides.push({
      slideIndex,
      sceneId: selected.scene.id,
      variantId: selected.variant.id,
      backgroundMode: selected.variant.backgroundMode,
      emphasis: slide.visual.emphasis,
      assetRequests,
      fallbackSceneId: selected.scene.fallback.sceneId,
      fallbackVariantId: selected.scene.fallback.variantId,
      fallbackApplied: imageIntentFallback,
      unresolvedRequiredRequestIds: [],
      score: selected.score,
      rationaleCodes: [
        ...(selected.score.roleMatch ? ["role-match"] : []),
        ...(selected.score.purposeMatch ? ["purpose-match"] : []),
        ...(selected.score.compositionMatch ? ["composition-match"] : []),
        ...(selected.score.contentFit ? ["content-fit"] : []),
        ...(selected.score.rhythmBonus ? ["background-rhythm"] : []),
        ...(selected.score.repetitionPenalty ? ["repetition-penalty"] : []),
        ...(imageIntentFallback ? ["image-intent-fallback"] : []),
      ],
    });
  });

  return directedDeckPlanV1Schema.parse({
    version: 1,
    packId: "editorial-business",
    compilerVersion: input.compilerVersion,
    slides,
  });
}

export function applyCommercialAssetFallbacks(input: {
  spec: LeanDeckSpecV2;
  plan: DirectedDeckPlanV1;
  manifest: ResolvedAssetManifestV1;
}): DirectedDeckPlanV1 {
  const slides = input.plan.slides.map((planSlide) => {
    const required = planSlide.assetRequests.filter((request) => request.required);
    const unresolvedRequiredRequestIds = required
      .filter((request) => !input.manifest.assets.some((asset) =>
        asset.requestId === request.requestId && asset.status === "resolved"
      ))
      .map((request) => request.requestId);
    const resolvedRequestCount = planSlide.assetRequests.filter((request) =>
      input.manifest.assets.some((asset) =>
        asset.requestId === request.requestId && asset.status === "resolved"
      )
    ).length;
    const shouldFallback =
      unresolvedRequiredRequestIds.length > 0
      || (planSlide.assetRequests.length > 0 && resolvedRequestCount === 0);
    if (!shouldFallback) {
      return {
        ...planSlide,
        fallbackApplied: planSlide.fallbackApplied,
        unresolvedRequiredRequestIds: [],
      };
    }

    const fallback = commercialSceneRegistry.get(planSlide.fallbackSceneId);
    const fallbackVariant = commercialSceneRegistry.getVariant(
      fallback.id,
      planSlide.fallbackVariantId,
    );
    return {
      ...planSlide,
      sceneId: fallback.id,
      variantId: fallbackVariant.id,
      backgroundMode: fallbackVariant.backgroundMode,
      fallbackApplied: true,
      unresolvedRequiredRequestIds,
      rationaleCodes: [
        ...planSlide.rationaleCodes,
        unresolvedRequiredRequestIds.length > 0
          ? "required-asset-fallback"
          : "optional-asset-fallback",
      ],
    };
  });
  return directedDeckPlanV1Schema.parse({ ...input.plan, slides });
}
