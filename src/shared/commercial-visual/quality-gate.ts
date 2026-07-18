import type { LeanDeckSpecV2 } from "../lean/deck-spec-v2";
import { presentationSchema, type Presentation } from "../presentation";
import type {
  DirectedDeckPlanV1,
  ResolvedAssetManifestV1,
} from "./contracts";
import { commercialSceneRegistry } from "./scene-registry";

export interface CommercialQualityIssue {
  code: string;
  severity: "error" | "warning";
  slideId?: string;
  sceneId?: string;
  message: string;
  evidence: string;
  fixHint: string;
  ruleVersion: "commercial-v2.1";
}

export interface CommercialVisualScore {
  hierarchy: number;
  composition: number;
  assetQuality: number;
  variety: number;
  rhythm: number;
  brandConsistency: number;
  editability: number;
  overall: number;
}

export interface CommercialQualityReport {
  passed: boolean;
  hardFailures: CommercialQualityIssue[];
  warnings: CommercialQualityIssue[];
  scores: CommercialVisualScore;
  sceneStats: { distinctScenes: number; repeatedAdjacentScenes: number };
  assetStats: { requested: number; resolved: number; unavailable: number };
  determinism: {
    canonicalHash: string;
    verified: boolean;
    commandReplayVerified: boolean;
  };
}

function issue(
  code: string,
  severity: CommercialQualityIssue["severity"],
  message: string,
  fixHint: string,
  slide?: Presentation["slides"][number],
): CommercialQualityIssue {
  return {
    code,
    severity,
    slideId: slide?.id,
    sceneId: slide?.sceneRef?.sceneId,
    message,
    evidence: slide ? `slide=${slide.id}` : "deck",
    fixHint,
    ruleVersion: "commercial-v2.1",
  };
}

export function evaluateCommercialQuality(input: {
  spec: LeanDeckSpecV2;
  plan: DirectedDeckPlanV1;
  assets: ResolvedAssetManifestV1;
  presentation: Presentation;
  canonicalHash: string;
  determinismVerified: boolean;
  commandReplayVerified: boolean;
}): CommercialQualityReport {
  const hardFailures: CommercialQualityIssue[] = [];
  const warnings: CommercialQualityIssue[] = [];
  const parsed = presentationSchema.safeParse(input.presentation);
  if (!parsed.success) {
    hardFailures.push(issue(
      "presentation-schema-invalid",
      "error",
      parsed.error.message,
      "Fix the scene compiler output before submitting commands.",
    ));
  }
  if (!input.determinismVerified) {
    hardFailures.push(issue(
      "compiler-nondeterministic",
      "error",
      "Repeated compilation did not produce identical Presentation, commands and hash.",
      "Remove time, random and environment-dependent values from pure compilation.",
    ));
  }
  if (!input.commandReplayVerified) {
    hardFailures.push(issue(
      "command-replay-mismatch",
      "error",
      "Replaying compiled commands did not reproduce the compiled Presentation.",
      "Fix command ordering or command payload normalization.",
    ));
  }

  input.presentation.slides.forEach((slide, slideIndex) => {
    const specSlide = input.spec.slides[slideIndex];
    if (!slide.sceneRef) {
      hardFailures.push(issue(
        "scene-ref-missing",
        "error",
        `Slide ${slideIndex + 1} has no commercial scene metadata.`,
        "Compile the slide through CommercialSceneRegistry.",
        slide,
      ));
    }
    for (const element of slide.elements) {
      if (element.type === "text" && element.text.trim() === "") {
        hardFailures.push(issue(
          "empty-text",
          "error",
          "An empty text element was emitted.",
          "Do not compile empty content units.",
          slide,
        ));
      }
      if (
        element.x < 0
        || element.y < 0
        || element.x + element.width > 1280
        || element.y + element.height > 720
      ) {
        hardFailures.push(issue(
          "element-out-of-bounds",
          "error",
          `Element '${element.id}' is outside the 1280×720 canvas.`,
          "Adjust the scene slot or element dimensions.",
          slide,
        ));
      }
      if (element.type === "image" && /^https?:\/\//i.test(element.url)) {
        hardFailures.push(issue(
          "remote-image",
          "error",
          "Remote images must be localized before compilation.",
          "Resolve the asset into the workspace manifest.",
          slide,
        ));
      }
    }
    if (specSlide && (specSlide.kind === "metric" || specSlide.kind === "chart")) {
      const referencedLabels = input.spec.sources
        .filter((source) => specSlide.sourceRefs.includes(source.id))
        .map((source) => source.label);
      const visibleText = slide.elements
        .filter((element) => element.type === "text")
        .map((element) => element.text)
        .join("\n");
      if (
        referencedLabels.length === 0
        || !referencedLabels.every((label) => visibleText.includes(label))
      ) {
        hardFailures.push(issue(
          "data-source-not-visible",
          "error",
          "Metric or chart source is not visible in the compiled slide.",
          "Compile every sourceRef into a visible caption.",
          slide,
        ));
      }
    }
  });

  const sceneIds = input.plan.slides.map((slide) => slide.sceneId);
  const distinctScenes = new Set(sceneIds).size;
  const repeatedAdjacentScenes = sceneIds.reduce(
    (count, sceneId, index) => count + (index > 0 && sceneIds[index - 1] === sceneId ? 1 : 0),
    0,
  );
  const requests = input.plan.slides.flatMap((slide) => slide.assetRequests);
  const resolved = input.assets.assets.filter((asset) => asset.status === "resolved").length;
  const unavailable = input.assets.assets.filter((asset) => asset.status === "unavailable").length;
  input.assets.assets
    .filter((asset) => asset.status === "resolved" && asset.licenseStatus === "unknown")
    .forEach(() => warnings.push(issue(
      "asset-license-unknown",
      "warning",
      "An asset license has not been verified.",
      "Review the source page before commercial delivery.",
    )));

  const requiredDistinctScenes = input.spec.slides.length >= 8 ? 5 : 3;
  if (distinctScenes < requiredDistinctScenes) {
    warnings.push(issue(
      "scene-variety-insufficient",
      "warning",
      `Deck uses ${distinctScenes} scenes; at least ${requiredDistinctScenes} are required.`,
      "Adjust role/composition choices or Director scoring to increase structural variety.",
    ));
  }
  if (repeatedAdjacentScenes > 0) {
    warnings.push(issue(
      "adjacent-scene-repeat",
      "warning",
      `Deck repeats the same scene on ${repeatedAdjacentScenes} adjacent transition(s).`,
      "Select a compatible alternate scene or variant for the repeated slide.",
    ));
  }

  input.plan.slides.forEach((planSlide, slideIndex) => {
    const slide = input.presentation.slides[slideIndex];
    if (planSlide.rationaleCodes.includes("image-intent-fallback")) {
      warnings.push(issue(
        "image-intent-fallback",
        "warning",
        "The requested image treatment is unavailable for this slide type; an asset-free variant was used.",
        "Review the asset-free composition or choose a slide type with an image-capable scene.",
        slide,
      ));
    }
    const unresolved = planSlide.assetRequests
      .filter((request) => request.required)
      .filter((request) => !input.assets.assets.some((asset) =>
        asset.requestId === request.requestId && asset.status === "resolved"
      ));
    if (unresolved.length > 0 && !planSlide.fallbackApplied) {
      hardFailures.push(issue(
        "required-asset-unresolved",
        "error",
        `Required asset request(s) are unresolved: ${unresolved.map((item) => item.requestId).join(", ")}.`,
        "Resolve all required slots or apply the declared no-image fallback.",
        slide,
      ));
    } else if (unresolved.length > 0) {
      warnings.push(issue(
        "required-asset-fallback",
        "warning",
        `Required assets were unavailable and fallback was applied: ${unresolved.map((item) => item.requestId).join(", ")}.`,
        "Review the fallback composition and retry asset resolution when appropriate.",
        slide,
      ));
    } else if (planSlide.fallbackApplied && planSlide.assetRequests.length > 0) {
      warnings.push(issue(
        "optional-asset-fallback",
        "warning",
        "Optional assets were unavailable and an asset-free fallback was applied.",
        "Review the fallback composition or retry image search.",
        slide,
      ));
    }
    if (planSlide.fallbackApplied) {
      const fallbackVariant = commercialSceneRegistry.getVariant(
        planSlide.sceneId,
        planSlide.variantId,
      );
      if (fallbackVariant.assetSlots.some((slot) => slot.required)) {
        hardFailures.push(issue(
          "fallback-still-requires-assets",
          "error",
          "Fallback variant still contains required asset slots.",
          "Use a genuinely asset-free fallback variant.",
          slide,
        ));
      }
    }
    if (planSlide.sceneId === "project-gallery" && !planSlide.fallbackApplied) {
      const resolvedGallerySlots = planSlide.assetRequests.filter((request) =>
        input.assets.assets.some((asset) =>
          asset.requestId === request.requestId && asset.status === "resolved"
        )
      ).length;
      if (resolvedGallerySlots < 3) {
        hardFailures.push(issue(
          "gallery-assets-incomplete",
          "error",
          "Project gallery requires three resolved image slots.",
          "Resolve grid-0, grid-1 and grid-2 or compile the split-case fallback.",
          slide,
        ));
      }
    }
  });

  const textElements = input.presentation.slides.flatMap((slide) =>
    slide.elements.filter((element) => element.type === "text")
  );
  const roleCoverage = textElements.length === 0
    ? 0
    : textElements.filter((element) => Boolean(element.textRole)).length / textElements.length;
  const fontSizes = textElements.map((element) => element.fontSize);
  const hierarchyRatio = fontSizes.length === 0
    ? 0
    : Math.max(...fontSizes) / Math.max(1, Math.min(...fontSizes));
  const hierarchy = Math.min(
    100,
    Math.round(roleCoverage * 55 + Math.min(1, hierarchyRatio / 3) * 45),
  );
  const outOfBoundsCount = hardFailures.filter(
    (candidate) => candidate.code === "element-out-of-bounds",
  ).length;
  const composition = Math.max(0, 100 - outOfBoundsCount * 25);
  const editableElements = input.presentation.slides.flatMap((slide) => slide.elements)
    .filter((element) =>
      element.type === "text"
      || element.type === "shape"
      || element.type === "image"
      || element.type === "chart"
    );
  const editability = editableElements.length === 0 ? 0 : 100;
  const slidesWithStyle = input.presentation.slides.filter((slide) =>
    slide.elements.every((element) =>
      element.type !== "text" || Boolean(element.color && element.fontFamily)
    )
  ).length;
  const brandConsistency = input.presentation.slides.length === 0
    ? 0
    : Math.round((slidesWithStyle / input.presentation.slides.length) * 100);

  const variety = Math.min(100, Math.round((distinctScenes / Math.min(5, input.spec.slides.length)) * 100));
  const rhythm = Math.max(0, 100 - repeatedAdjacentScenes * 20);
  const assetQuality = requests.length === 0
    ? 100
    : Math.round((resolved / requests.length) * 100);
  const scores: CommercialVisualScore = {
    hierarchy,
    composition,
    assetQuality,
    variety,
    rhythm,
    brandConsistency,
    editability,
    overall: 0,
  };
  scores.overall = Math.round(
    Object.entries(scores)
      .filter(([key]) => key !== "overall")
      .reduce((sum, [, value]) => sum + value, 0) / 7,
  );

  return {
    passed: hardFailures.length === 0,
    hardFailures,
    warnings,
    scores,
    sceneStats: { distinctScenes, repeatedAdjacentScenes },
    assetStats: { requested: requests.length, resolved, unavailable },
    determinism: {
      canonicalHash: input.canonicalHash,
      verified: input.determinismVerified,
      commandReplayVerified: input.commandReplayVerified,
    },
  };
}
