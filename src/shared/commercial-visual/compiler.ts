import {
  DESIGN_PRESETS,
  resolveSlideStyle,
  type DesignSystemV1,
} from "@design-system";

import {
  compileLeanDeckSpec,
  type LeanDeckSpec,
} from "../lean-mode";
import {
  leanDeckSpecV2Schema,
  type LeanDeckSpecV2,
} from "../lean/deck-spec-v2";
import type { PresentationCommand } from "../commands";
import {
  presentationSchema,
  type ImageElement,
  type Presentation,
  type Slide,
} from "../presentation";
import {
  directedDeckPlanV1Schema,
  resolvedAssetManifestV1Schema,
  type DirectedDeckPlanV1,
  type ResolvedAssetManifestV1,
} from "./contracts";
import {
  canonicalPresentationHash,
  createDeterministicIdFactory,
} from "./deterministic-id-factory";
import { commercialSceneRegistry } from "./scene-registry";

export interface CompiledCommercialDeck {
  presentation: Presentation;
  commands: PresentationCommand[];
  diagnostics: Array<{
    code: string;
    slideIndex?: number;
    message: string;
  }>;
  canonicalHash: string;
}

function asV1Spec(spec: LeanDeckSpecV2): LeanDeckSpec {
  return {
    ...spec,
    version: 1,
    slides: spec.slides.map(({ visual: _visual, ...slide }) => slide),
  };
}

function resolveDesignSystem(
  spec: LeanDeckSpecV2,
  override?: DesignSystemV1,
): DesignSystemV1 {
  if (override) return structuredClone(override);
  const preset = DESIGN_PRESETS.find((candidate) => candidate.id === spec.designPreset);
  if (!preset) throw new Error(`Unknown design preset '${spec.designPreset}'.`);
  return structuredClone(preset.system);
}

function assetImage(
  asset: ResolvedAssetManifestV1["assets"][number],
  request: DirectedDeckPlanV1["slides"][number]["assetRequests"][number],
  id: string,
): ImageElement | undefined {
  if (
    asset.status !== "resolved"
    || !asset.localPath
    || !asset.sha256
    || !asset.mimeType
    || asset.licenseStatus === "restricted"
  ) {
    return undefined;
  }
  return {
    id,
    type: "image",
    provenance: "asset",
    x: 120,
    y: 180,
    width: 1040,
    height: 440,
    url: asset.renderUrl ?? asset.localPath,
    borderRadius: 0,
    imageSlot: request.slotId,
    objectFit: "cover",
    crop: asset.safeCrop,
    asset: {
      provider: asset.provider,
      sourceUrl: asset.sourceUrl,
      sourcePageUrl: asset.sourcePageUrl,
      attribution: asset.attribution,
      license: asset.license,
      localPath: asset.localPath,
      mimeType: asset.mimeType,
      pixelWidth: asset.pixelWidth,
      pixelHeight: asset.pixelHeight,
      sha256: asset.sha256,
    },
  };
}

function compileCommands(
  base: Presentation,
  output: Presentation,
  compilerVersion: string,
): PresentationCommand[] {
  const ids = createDeterministicIdFactory(
    `${base.id}:${base.revision}:${output.title}:${compilerVersion}`,
  );
  return [
    ...base.slides.map((slide, index): PresentationCommand => ({
      id: ids.id("command", "remove-slide", index, slide.id),
      type: "remove-slide",
      slideId: slide.id,
    })),
    {
      id: ids.id("command", "set-title"),
      type: "set-presentation-title",
      title: output.title,
    },
    {
      id: ids.id("command", "set-design-system"),
      type: "set-design-system",
      designSystem: output.designSystem,
    },
    ...output.slides.map((slide, index): PresentationCommand => ({
      id: ids.id("command", "add-slide", index, slide.id),
      type: "add-slide",
      slide,
      index,
    })),
  ];
}

export function compileCommercialDeck(input: {
  spec: LeanDeckSpecV2;
  plan: DirectedDeckPlanV1;
  assets: ResolvedAssetManifestV1;
  basePresentation: Presentation;
  compilerVersion: string;
  designSystem?: DesignSystemV1;
}): CompiledCommercialDeck {
  const spec = leanDeckSpecV2Schema.parse(input.spec);
  const plan = directedDeckPlanV1Schema.parse(input.plan);
  const assets = resolvedAssetManifestV1Schema.parse(input.assets);
  if (plan.compilerVersion !== input.compilerVersion) {
    throw new Error(
      `Plan compiler version '${plan.compilerVersion}' does not match '${input.compilerVersion}'.`,
    );
  }
  if (plan.slides.length !== spec.slides.length) {
    throw new Error("Directed plan and DeckSpec slide counts do not match.");
  }

  const designSystem = resolveDesignSystem(spec, input.designSystem);
  const baseline = compileLeanDeckSpec(asV1Spec(spec), input.basePresentation, designSystem);
  const ids = createDeterministicIdFactory(
    `${spec.title}:${input.compilerVersion}:${plan.packId}`,
  );
  const diagnostics: CompiledCommercialDeck["diagnostics"] = [];

  const slides = baseline.presentation.slides.map((baselineSlide, slideIndex): Slide => {
    const planSlide = plan.slides[slideIndex];
    const specSlide = spec.slides[slideIndex];
    if (!planSlide || !specSlide || planSlide.slideIndex !== slideIndex) {
      throw new Error(`Invalid directed plan entry at slide ${slideIndex + 1}.`);
    }
    const scene = commercialSceneRegistry.get(planSlide.sceneId);
    const variant = commercialSceneRegistry.getVariant(scene.id, planSlide.variantId);
    const activeSlots = new Set(variant.assetSlots.map((slot) => slot.id));
    const resolvedImages = planSlide.assetRequests.flatMap((request, requestIndex) => {
      if (!activeSlots.has(request.slotId)) return [];
      const asset = assets.assets.find((candidate) => candidate.requestId === request.requestId);
      if (!asset) return [];
      const image = assetImage(
        asset,
        request,
        ids.id("asset", slideIndex, requestIndex, asset.sha256),
      );
      return image ? [image] : [];
    });

    const sceneInput: Slide = {
      ...baselineSlide,
      id: ids.id("slide", slideIndex, specSlide.kind, specSlide.title),
      slideVariant: planSlide.backgroundMode === "dark" ? "dark" : "light",
      sceneRef: {
        packId: plan.packId,
        sceneId: scene.id,
        variantId: planSlide.variantId,
      },
      elements: [...baselineSlide.elements, ...resolvedImages],
    };
    const style = resolveSlideStyle(designSystem, sceneInput);
    const laidOut = scene.compile({
      slide: sceneInput,
      variantId: planSlide.variantId,
      style,
      emphasis: planSlide.emphasis,
    });
    const normalized: Slide = {
      ...laidOut,
      sceneRef: sceneInput.sceneRef,
      elements: laidOut.elements.map((element, elementIndex) => ({
        ...element,
        id: ids.id("element", slideIndex, elementIndex, element.type),
      })),
    };
    diagnostics.push({
      code: "scene-compiled",
      slideIndex,
      message: `${scene.id}/${planSlide.variantId}`,
    });
    return normalized;
  });

  const presentation = presentationSchema.parse({
    id: input.basePresentation.id,
    title: spec.title,
    revision: input.basePresentation.revision,
    designSystem,
    slides,
  });
  const canonicalHash = canonicalPresentationHash({
    spec,
    plan,
    assets: assets.assets
      .filter((asset) =>
        plan.slides.some((slide) =>
          slide.assetRequests.some((request) => request.requestId === asset.requestId)
        )
      )
      .map((asset) => ({
        requestId: asset.requestId,
        sha256: asset.sha256,
        safeCrop: asset.safeCrop,
        status: asset.status,
      })),
    designSystem,
    compilerVersion: input.compilerVersion,
    presentation: {
      ...presentation,
      revision: 0,
    },
  });

  return {
    presentation,
    commands: compileCommands(input.basePresentation, presentation, input.compilerVersion),
    diagnostics,
    canonicalHash,
  };
}
