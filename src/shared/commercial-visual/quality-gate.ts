import type { LeanDeckSpecV2, LeanSlideSpecV2 } from "../lean/deck-spec-v2";
import {
  presentationSchema,
  type Presentation,
  type SlideElement,
} from "../presentation";
import type {
  DirectedDeckPlanV1,
  ResolvedAssetManifestV1,
} from "./contracts";
import { commercialSceneRegistry } from "./scene-registry";
import { findEmptyLayoutCards } from "../layout-shape-utils";

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
  assetQuality: number | null;
  variety: number;
  rhythm: number;
  brandConsistency: number;
  editability: number;
  visualFocus: number;
  cardWallControl: number;
  overall: number;
}

export interface CommercialScoreDetail {
  status: "scored" | "not-applicable";
  score: number | null;
  evidence: string[];
}

export type CommercialScoreDimension = Exclude<keyof CommercialVisualScore, "overall">;

export interface CommercialQualityReport {
  passed: boolean;
  hardFailures: CommercialQualityIssue[];
  warnings: CommercialQualityIssue[];
  scores: CommercialVisualScore;
  scoreDetails: Record<CommercialScoreDimension, CommercialScoreDetail>;
  brandSignals: {
    tokenConsistency: number;
    motifContinuity: number;
    visualDistinctiveness: null;
  };
  humanReview: {
    status: "not-reviewed";
    rubricVersion: "commercial-visual-human-v1";
    requiredDimensions: [
      "visual-distinctiveness",
      "message-impact",
      "brand-fit",
    ];
  };
  sceneStats: {
    distinctScenes: number;
    repeatedAdjacentScenes: number;
    strongVisualSlides: number;
    requiredStrongVisualSlides: number;
    visualFocusSlides: number;
    cardWallSlides: number;
  };
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

function requiredContentUnits(
  slide: LeanSlideSpecV2,
  spec: LeanDeckSpecV2,
): string[] {
  const units = [
    slide.title,
    slide.subtitle,
    ...slide.items.flatMap((item) => [item.heading, item.detail]),
    ...(slide.left ? [slide.left.label, ...slide.left.items] : []),
    ...(slide.right ? [slide.right.label, ...slide.right.items] : []),
    ...slide.steps.flatMap((step) => [step.heading, step.detail]),
    ...(slide.metric
      ? [slide.metric.value, slide.metric.label, slide.metric.takeaway]
      : []),
    ...(slide.chart
      ? [
          slide.chart.takeaway,
          slide.chart.unit,
          ...slide.chart.items.flatMap((item) => [item.label, String(item.value)]),
        ]
      : []),
    ...spec.sources
      .filter((source) => slide.sourceRefs.includes(source.id))
      .map((source) => source.label),
  ];
  return [...new Set(units.map((unit) => unit.trim()).filter(Boolean))];
}

function compiledContentCorpus(
  slide: Presentation["slides"][number],
): string {
  const parts = [slide.title];
  for (const element of slide.elements) {
    if (element.type === "text") parts.push(element.text);
    if (element.type === "chart") {
      if (element.unit) parts.push(element.unit);
      for (const item of element.data.items ?? []) {
        parts.push(item.label, String(item.value));
      }
      parts.push(...(element.data.labels ?? []));
      parts.push(...(element.data.values ?? []).map(String));
    }
    if (element.type === "table") {
      parts.push(...element.rows.flat());
    }
  }
  return parts.join("\n");
}

function isForegroundElement(element: SlideElement): boolean {
  return element.type !== "shape";
}

function isFullBleedBackground(element: SlideElement): boolean {
  return element.type === "image"
    && element.width * element.height >= 1280 * 720 * 0.7;
}

function isStrongVisualSlide(
  slide: Presentation["slides"][number],
): boolean {
  const supportsStatementFocus = slide.sceneRef && [
    "cinematic-cover",
    "hero-narrative",
    "minimal-epilogue",
  ].includes(slide.sceneRef.sceneId);
  return slide.elements.some((element) =>
    element.type === "chart"
    || element.type === "image"
    || (
      element.type === "text"
      && element.textRole === "metric"
      && element.provenance !== "layout"
    )
    || (
      element.type === "text"
      && Boolean(supportsStatementFocus)
      && element.fontSize >= 36
      && element.y >= 140
      && element.width * element.height >= 1280 * 720 * 0.05
    )
  );
}

function isCardWallSlide(slide: Presentation["slides"][number]): boolean {
  const canvasArea = 1280 * 720;
  const largeLayoutCards = slide.elements.filter((element) =>
    element.type === "shape"
    && element.provenance === "layout"
    && element.width >= 240
    && element.height >= 100
    && element.width * element.height >= canvasArea * 0.08
    && element.width * element.height <= canvasArea * 0.6
  );
  const hasMediaOrMetric = slide.elements.some((element) =>
    element.type === "image"
    || element.type === "chart"
    || (
      element.type === "text"
      && element.textRole === "metric"
      && element.provenance !== "layout"
    )
  );
  return largeLayoutCards.length >= 3 && !hasMediaOrMetric;
}

function sharedMotifScore(presentation: Presentation): number {
  if (presentation.slides.length < 2) return 0;
  const motifColors = (slide: Presentation["slides"][number]) => new Set(
    slide.elements
      .filter((element): element is Extract<SlideElement, { type: "shape" }> =>
        element.type === "shape" && element.provenance === "layout"
      )
      .flatMap((element) => [element.fillColor, element.strokeColor])
      .filter((color): color is string => Boolean(color))
      .map((color) => color.toLowerCase())
      .filter((color) => color !== "#ffffff" && color !== "#000000"),
  );
  const opening = motifColors(presentation.slides[0]!);
  const closing = motifColors(presentation.slides[presentation.slides.length - 1]!);
  return [...opening].some((color) => closing.has(color)) ? 100 : 0;
}

function overlapRatio(first: SlideElement, second: SlideElement): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width)
      - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height)
      - Math.max(first.y, second.y),
  );
  const intersection = width * height;
  return intersection / Math.max(1, Math.min(
    first.width * first.height,
    second.width * second.height,
  ));
}

interface ForegroundOverlap {
  first: SlideElement;
  second: SlideElement;
  ratio: number;
}

function foregroundOverlaps(
  slide: Presentation["slides"][number],
): ForegroundOverlap[] {
  const foreground = slide.elements.filter(
    (element) => isForegroundElement(element) && !isFullBleedBackground(element),
  );
  const overlaps: ForegroundOverlap[] = [];
  for (let firstIndex = 0; firstIndex < foreground.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < foreground.length; secondIndex += 1) {
      const first = foreground[firstIndex]!;
      const second = foreground[secondIndex]!;
      const ratio = overlapRatio(first, second);
      if (ratio >= 0.15) overlaps.push({ first, second, ratio });
    }
  }
  return overlaps;
}

function overlapEvidence(overlap: ForegroundOverlap): string {
  const { first, second, ratio } = overlap;
  const rect = (element: SlideElement) =>
    `${element.type}:${element.id}[${element.x},${element.y},${element.width}×${element.height}]`;
  return `${rect(first)}/${rect(second)} (${Math.round(ratio * 100)}%)`;
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
    if (specSlide) {
      const corpus = compiledContentCorpus(slide);
      const missingUnits = requiredContentUnits(specSlide, input.spec)
        .filter((unit) => !corpus.includes(unit));
      if (missingUnits.length > 0) {
        hardFailures.push(issue(
          "content-unit-unconsumed",
          "error",
          `Required content was not consumed: ${missingUnits.join(" | ")}.`,
          "Compile each DeckSpec content unit into its declared scene slot.",
          slide,
        ));
      }
    }
    const overlaps = foregroundOverlaps(slide);
    const blockingOverlaps = overlaps.filter(({ first, second }) =>
      first.type === "text" && second.type === "text"
    );
    const mediaOverlaps = overlaps.filter(({ first, second }) =>
      first.type !== "text" || second.type !== "text"
    );
    if (blockingOverlaps.length > 0) {
      hardFailures.push(issue(
        "foreground-overlap",
        "error",
        `Foreground text elements overlap materially: ${blockingOverlaps
          .map(overlapEvidence)
          .join(", ")}.`,
        "Assign text, data and media to non-overlapping scene slots.",
        slide,
      ));
    }
    if (mediaOverlaps.length > 0) {
      warnings.push(issue(
        "foreground-media-overlap",
        "warning",
        `Foreground media elements overlap: ${mediaOverlaps
          .map(overlapEvidence)
          .join(", ")}.`,
        "Review the media layering in preview; adjust the scene only if readability is affected.",
        slide,
      ));
    }
    const emptyCards = findEmptyLayoutCards(slide.elements);
    if (emptyCards.length > 0) {
      hardFailures.push(issue(
        "empty-layout-card",
        "error",
        `Empty layout card(s) were emitted: ${emptyCards.map((card) => card.id).join(", ")}.`,
        "Remove unused containers or populate their declared content slot.",
        slide,
      ));
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
  const sceneSignatures = input.plan.slides.map(
    (slide) => `${slide.sceneId}/${slide.variantId}`,
  );
  const repeatedAdjacentScenes = sceneSignatures.reduce(
    (count, signature, index) =>
      count + (index > 0 && sceneSignatures[index - 1] === signature ? 1 : 0),
    0,
  );
  const strongVisualSlides = input.presentation.slides.filter(isStrongVisualSlide).length;
  const visualFocusSlideIds = input.presentation.slides
    .filter(isStrongVisualSlide)
    .map((slide) => slide.id);
  const cardWallSlideIds = input.presentation.slides
    .filter(isCardWallSlide)
    .map((slide) => slide.id);
  const requiredStrongVisualSlides = input.spec.slides.length >= 6
    ? Math.ceil(input.spec.slides.length / 2)
    : 0;
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
    const collection = input.spec.slides.length >= 6 ? hardFailures : warnings;
    collection.push(issue(
      "scene-variety-insufficient",
      input.spec.slides.length >= 6 ? "error" : "warning",
      `Deck uses ${distinctScenes} scenes; at least ${requiredDistinctScenes} are required.`,
      "Adjust role/composition choices or Director scoring to increase structural variety.",
    ));
  }
  if (repeatedAdjacentScenes > 0) {
    const collection = input.spec.slides.length >= 6 ? hardFailures : warnings;
    collection.push(issue(
      "adjacent-scene-repeat",
      input.spec.slides.length >= 6 ? "error" : "warning",
      `Deck repeats the same scene and variant on ${repeatedAdjacentScenes} adjacent transition(s).`,
      "Select a compatible alternate scene or variant before commercial delivery.",
    ));
  }
  if (strongVisualSlides < requiredStrongVisualSlides) {
    hardFailures.push(issue(
      "strong-visual-coverage-insufficient",
      "error",
      `Deck has ${strongVisualSlides} strong visual slide(s); at least ${requiredStrongVisualSlides} are required.`,
      "Add image-led, metric, chart, hero or statement scenes so at least half the deck has a clear visual anchor.",
    ));
  }
  if (cardWallSlideIds.length / Math.max(1, input.presentation.slides.length) >= 0.25) {
    warnings.push(issue(
      "card-wall-overuse",
      "warning",
      `Deck uses repeated large-card compositions on ${cardWallSlideIds.length} slide(s).`,
      "Replace repeated card groups with a stronger visual anchor, comparison, process, or evidence composition.",
    ));
  }

  input.plan.slides.forEach((planSlide, slideIndex) => {
    const slide = input.presentation.slides[slideIndex];
    const consumedSlots = new Set(
      slide?.elements
        .filter((element) => element.type === "image")
        .map((element) => element.imageSlot)
        .filter((slot): slot is string => Boolean(slot)) ?? [],
    );
    const unconsumedResolvedSlots = planSlide.assetRequests.filter((request) =>
      input.assets.assets.some((asset) =>
        asset.requestId === request.requestId && asset.status === "resolved"
      ) && !consumedSlots.has(request.slotId)
    );
    if (unconsumedResolvedSlots.length > 0) {
      hardFailures.push(issue(
        "resolved-asset-slot-unconsumed",
        "error",
        `Resolved asset slot(s) were not rendered: ${unconsumedResolvedSlots
          .map((request) => request.slotId)
          .join(", ")}.`,
        "Place each resolved asset in the exact slot declared by the Scene variant.",
        slide,
      ));
    }
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
  const overlapCount = hardFailures.filter(
    (candidate) => candidate.code === "foreground-overlap",
  ).length + warnings.filter(
    (candidate) => candidate.code === "foreground-media-overlap",
  ).length;
  const emptyCardCount = hardFailures.filter(
    (candidate) => candidate.code === "empty-layout-card",
  ).length;
  const unconsumedContentCount = hardFailures.filter(
    (candidate) => candidate.code === "content-unit-unconsumed",
  ).length;
  const composition = Math.max(
    0,
    100
      - outOfBoundsCount * 25
      - overlapCount * 25
      - emptyCardCount * 15
      - unconsumedContentCount * 20,
  );
  const editableElements = input.presentation.slides.flatMap((slide) => slide.elements)
    .filter((element) =>
      element.type === "text"
      || element.type === "shape"
      || element.type === "image"
      || element.type === "chart"
    );
  const slidesWithEditableContent = input.presentation.slides.filter((slide) =>
    slide.elements.some((element) =>
      element.type === "text"
      || element.type === "shape"
      || element.type === "image"
      || element.type === "chart"
    )
  ).length;
  const editability = editableElements.length === 0 || input.presentation.slides.length === 0
    ? 0
    : Math.round((slidesWithEditableContent / input.presentation.slides.length) * 100);
  const slidesWithStyle = input.presentation.slides.filter((slide) =>
    slide.elements.every((element) =>
      element.type !== "text" || Boolean(element.color && element.fontFamily)
    )
  ).length;
  const tokenConsistency = input.presentation.slides.length === 0
    ? 0
    : Math.round((slidesWithStyle / input.presentation.slides.length) * 100);
  const motifContinuity = sharedMotifScore(input.presentation);
  const brandConsistency = Math.round((tokenConsistency + motifContinuity) / 2);

  const variety = Math.min(100, Math.round((distinctScenes / Math.min(5, input.spec.slides.length)) * 100));
  const rhythm = Math.max(0, 100 - repeatedAdjacentScenes * 20);
  const slidesWithAssetIntent = input.spec.slides.filter(
    (slide) => slide.visual.imageMode !== "none",
  ).length;
  const assetQuality = requests.length === 0
    ? (slidesWithAssetIntent === 0 ? null : 0)
    : Math.round((resolved / requests.length) * 100);
  if (slidesWithAssetIntent > 0 && requests.length === 0) {
    warnings.push(issue(
      "asset-intent-unplanned",
      "warning",
      `${slidesWithAssetIntent} slide(s) declare image intent, but the Director emitted no asset requests.`,
      "Plan asset requests for image intent or record an explicit asset-free fallback.",
    ));
  }
  const visualFocus = requiredStrongVisualSlides === 0
    ? 100
    : Math.min(100, Math.round((strongVisualSlides / requiredStrongVisualSlides) * 100));
  const cardWallControl = Math.max(
    0,
    100 - Math.round(
      (cardWallSlideIds.length / Math.max(1, input.presentation.slides.length)) * 240,
    ),
  );
  const scores: CommercialVisualScore = {
    hierarchy,
    composition,
    assetQuality,
    variety,
    rhythm,
    brandConsistency,
    editability,
    visualFocus,
    cardWallControl,
    overall: 0,
  };
  const applicableScores = Object.entries(scores)
    .filter(([key, value]) => key !== "overall" && value !== null)
    .map(([, value]) => value as number);
  scores.overall = applicableScores.length === 0
    ? 0
    : Math.round(applicableScores.reduce((sum, value) => sum + value, 0) / applicableScores.length);
  const cardWallOveruse = cardWallSlideIds.length
    / Math.max(1, input.presentation.slides.length) >= 0.25;
  if (assetQuality === null && cardWallOveruse) {
    scores.overall = Math.min(scores.overall, 89);
  }

  const scoreDetails: Record<CommercialScoreDimension, CommercialScoreDetail> = {
    hierarchy: {
      status: "scored",
      score: hierarchy,
      evidence: [
        `${Math.round(roleCoverage * 100)}% text-role coverage`,
        `${hierarchyRatio.toFixed(2)}x font-size range`,
      ],
    },
    composition: {
      status: "scored",
      score: composition,
      evidence: [
        `${outOfBoundsCount} out-of-bounds`,
        `${overlapCount} material overlaps`,
        `${emptyCardCount} empty cards`,
        `${unconsumedContentCount} unconsumed content units`,
      ],
    },
    assetQuality: assetQuality === null
      ? {
          status: "not-applicable",
          score: null,
          evidence: ["All slides explicitly declare imageMode=none; asset quality was not scored."],
        }
      : {
          status: "scored",
          score: assetQuality,
          evidence: [
            `${slidesWithAssetIntent} slide(s) with image intent`,
            `${resolved}/${requests.length} asset requests resolved`,
          ],
        },
    variety: {
      status: "scored",
      score: variety,
      evidence: [`${distinctScenes} distinct scene(s)`],
    },
    rhythm: {
      status: "scored",
      score: rhythm,
      evidence: [`${repeatedAdjacentScenes} repeated adjacent scene transition(s)`],
    },
    brandConsistency: {
      status: "scored",
      score: brandConsistency,
      evidence: [
        `${tokenConsistency}/100 token consistency`,
        `${motifContinuity}/100 opening-to-closing motif continuity`,
        "Visual distinctiveness requires human review and is not included in this score.",
      ],
    },
    editability: {
      status: "scored",
      score: editability,
      evidence: [`${slidesWithEditableContent}/${input.presentation.slides.length} slides contain editable content`],
    },
    visualFocus: {
      status: "scored",
      score: visualFocus,
      evidence: [
        `${visualFocusSlideIds.length}/${input.presentation.slides.length} slide(s) have a measurable visual anchor`,
        `anchor slide ids: ${visualFocusSlideIds.join(", ") || "none"}`,
      ],
    },
    cardWallControl: {
      status: "scored",
      score: cardWallControl,
      evidence: [
        `${cardWallSlideIds.length}/${input.presentation.slides.length} slide(s) use large-card walls`,
        `card-wall slide ids: ${cardWallSlideIds.join(", ") || "none"}`,
      ],
    },
  };

  return {
    passed: hardFailures.length === 0,
    hardFailures,
    warnings,
    scores,
    scoreDetails,
    brandSignals: {
      tokenConsistency,
      motifContinuity,
      visualDistinctiveness: null,
    },
    humanReview: {
      status: "not-reviewed",
      rubricVersion: "commercial-visual-human-v1",
      requiredDimensions: [
        "visual-distinctiveness",
        "message-impact",
        "brand-fit",
      ],
    },
    sceneStats: {
      distinctScenes,
      repeatedAdjacentScenes,
      strongVisualSlides,
      requiredStrongVisualSlides,
      visualFocusSlides: visualFocusSlideIds.length,
      cardWallSlides: cardWallSlideIds.length,
    },
    assetStats: { requested: requests.length, resolved, unavailable },
    determinism: {
      canonicalHash: input.canonicalHash,
      verified: input.determinismVerified,
      commandReplayVerified: input.commandReplayVerified,
    },
  };
}
