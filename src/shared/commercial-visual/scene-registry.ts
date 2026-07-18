import type { ResolvedSlideStyle } from "@design-system";

import { applyLayout } from "../layout";
import type {
  CommercialVisualIntentV2,
  LeanSlideSpecV2,
} from "../lean/deck-spec-v2";
import type { Slide } from "../presentation";
import type { SlideLayoutType } from "../slide-layouts";
import {
  COMMERCIAL_SCENE_IDS,
  type CommercialSceneId,
} from "./contracts";

export interface CommercialSceneAssetSlot {
  id: string;
  required: boolean;
  targetAspectRatio: number;
}

export interface CommercialSceneVariantDefinition {
  id: string;
  layout: SlideLayoutType;
  grammarVariant?: string;
  backgroundMode: "light" | "dark" | "image";
  assetSlots: readonly CommercialSceneAssetSlot[];
}

export interface CommercialSceneCompileInput {
  slide: Slide;
  variantId: string;
  style: ResolvedSlideStyle;
  emphasis: readonly string[];
}

export interface CommercialSceneDefinition {
  id: CommercialSceneId;
  order: number;
  supportedRoles: readonly CommercialVisualIntentV2["role"][];
  supportedPurposes: readonly LeanSlideSpecV2["purpose"][];
  supportedCompositions: readonly CommercialVisualIntentV2["composition"][];
  variants: readonly CommercialSceneVariantDefinition[];
  fallback: { sceneId: CommercialSceneId; variantId: string };
  canPlan(slide: LeanSlideSpecV2): boolean;
  compile(input: CommercialSceneCompileInput): Slide;
}

const allBusinessPurposes: readonly LeanSlideSpecV2["purpose"][] = [
  "context", "problem", "insight", "solution", "proof", "plan", "ask",
];

function executableScene(
  definition: Omit<CommercialSceneDefinition, "compile">,
): CommercialSceneDefinition {
  return {
    ...definition,
    compile(input) {
      const variant = definition.variants.find((candidate) => candidate.id === input.variantId);
      if (!variant) {
        throw new Error(`Scene '${definition.id}' does not support variant '${input.variantId}'.`);
      }
      const laidOut = applyLayout(input.slide, variant.layout, input.style, {
        grammarVariant: variant.grammarVariant,
      });
      let elements = laidOut.elements.map((element) => {
        if (
          element.type !== "text"
          || !input.emphasis.some((emphasis) =>
            element.text.includes(emphasis)
          )
        ) {
          return element;
        }
        return {
          ...element,
          bold: true,
          color: input.style.colors.accent,
          fontSize: Math.min(64, element.fontSize * 1.08),
        };
      });
      if (definition.id === "cinematic-cover" && variant.id === "full-bleed") {
        const hero = elements.find(
          (element) => element.type === "image" && element.imageSlot === "hero",
        );
        if (hero?.type === "image") {
          const fullBleed = {
            ...hero,
            x: 0,
            y: 0,
            width: 1280,
            height: 720,
            borderRadius: 0,
          };
          elements = [fullBleed, ...elements.filter((element) => element.id !== hero.id)];
        }
      }
      return { ...laidOut, elements };
    },
  };
}

const definitions: CommercialSceneDefinition[] = [
  executableScene({
    id: "cinematic-cover",
    order: 0,
    supportedRoles: ["hero"],
    supportedPurposes: ["opening"],
    supportedCompositions: ["full-bleed", "minimal-statement"],
    variants: [
      {
        id: "full-bleed",
        layout: "cover",
        grammarVariant: "editorial-hero",
        backgroundMode: "image",
        assetSlots: [{ id: "hero", required: true, targetAspectRatio: 16 / 9 }],
      },
      {
        id: "dark-title",
        layout: "cover",
        grammarVariant: "editorial-hero",
        backgroundMode: "dark",
        assetSlots: [],
      },
    ],
    fallback: { sceneId: "cinematic-cover", variantId: "dark-title" },
    canPlan: (slide) => slide.kind === "cover",
  }),
  executableScene({
    id: "numbered-overview",
    order: 1,
    supportedRoles: ["overview", "process"],
    supportedPurposes: ["navigation", "plan"],
    supportedCompositions: ["editorial-grid"],
    variants: [{
      id: "numbered-list",
      layout: "toc",
      backgroundMode: "light",
      assetSlots: [],
    }],
    fallback: { sceneId: "numbered-overview", variantId: "numbered-list" },
    canPlan: (slide) => slide.kind === "agenda" || slide.kind === "process",
  }),
  executableScene({
    id: "hero-narrative",
    order: 2,
    supportedRoles: ["hero", "statement"],
    supportedPurposes: allBusinessPurposes,
    supportedCompositions: ["split", "minimal-statement", "full-bleed"],
    variants: [
      {
        id: "editorial-block",
        layout: "concept",
        backgroundMode: "light",
        assetSlots: [],
      },
      {
        id: "image-led",
        layout: "case",
        backgroundMode: "light",
        assetSlots: [{ id: "side", required: false, targetAspectRatio: 4 / 5 }],
      },
    ],
    fallback: { sceneId: "hero-narrative", variantId: "editorial-block" },
    canPlan: (slide) => slide.kind === "bullets" || slide.kind === "section",
  }),
  executableScene({
    id: "split-case",
    order: 3,
    supportedRoles: ["evidence", "hero", "statement", "gallery"],
    supportedPurposes: allBusinessPurposes,
    supportedCompositions: ["split", "editorial-grid", "image-collage"],
    variants: [
      {
        id: "fact-sidebar",
        layout: "case",
        backgroundMode: "light",
        assetSlots: [],
      },
      {
        id: "image-sidebar",
        layout: "case",
        backgroundMode: "light",
        assetSlots: [{ id: "side", required: false, targetAspectRatio: 4 / 5 }],
      },
    ],
    fallback: { sceneId: "split-case", variantId: "fact-sidebar" },
    canPlan: (slide) => !["cover", "agenda", "closing"].includes(slide.kind),
  }),
  executableScene({
    id: "dual-evidence",
    order: 4,
    supportedRoles: ["comparison", "evidence"],
    supportedPurposes: allBusinessPurposes,
    supportedCompositions: ["split", "editorial-grid"],
    variants: [{
      id: "balanced",
      layout: "comparison",
      backgroundMode: "light",
      assetSlots: [],
    }],
    fallback: { sceneId: "split-case", variantId: "fact-sidebar" },
    canPlan: (slide) => slide.kind === "comparison",
  }),
  executableScene({
    id: "metric-landscape",
    order: 5,
    supportedRoles: ["evidence", "hero"],
    supportedPurposes: ["proof", "insight"],
    supportedCompositions: ["metric-story", "split"],
    variants: [
      {
        id: "metric-focus",
        layout: "case",
        grammarVariant: "metric-focus",
        backgroundMode: "dark",
        assetSlots: [],
      },
      {
        id: "chart-focus",
        layout: "case",
        grammarVariant: "split",
        backgroundMode: "dark",
        assetSlots: [],
      },
    ],
    fallback: { sceneId: "split-case", variantId: "fact-sidebar" },
    canPlan: (slide) => slide.kind === "metric" || slide.kind === "chart",
  }),
  executableScene({
    id: "project-gallery",
    order: 6,
    supportedRoles: ["gallery", "evidence"],
    supportedPurposes: ["proof", "solution"],
    supportedCompositions: ["image-collage"],
    variants: [{
      id: "three-up",
      layout: "image-grid",
      backgroundMode: "light",
      assetSlots: [
        { id: "grid-0", required: true, targetAspectRatio: 4 / 3 },
        { id: "grid-1", required: true, targetAspectRatio: 4 / 3 },
        { id: "grid-2", required: true, targetAspectRatio: 4 / 3 },
      ],
    }],
    fallback: { sceneId: "split-case", variantId: "fact-sidebar" },
    canPlan: (slide) =>
      slide.visual.imageMode !== "none"
      && slide.visual.composition === "image-collage",
  }),
  executableScene({
    id: "minimal-epilogue",
    order: 7,
    supportedRoles: ["statement", "hero"],
    supportedPurposes: ["close", "ask"],
    supportedCompositions: ["minimal-statement"],
    variants: [{
      id: "closing-statement",
      layout: "summary",
      backgroundMode: "dark",
      assetSlots: [],
    }],
    fallback: { sceneId: "minimal-epilogue", variantId: "closing-statement" },
    canPlan: (slide) => slide.kind === "closing",
  }),
];

export class CommercialSceneRegistry {
  private readonly scenes = new Map<CommercialSceneId, CommercialSceneDefinition>();

  constructor(sceneDefinitions: readonly CommercialSceneDefinition[] = definitions) {
    for (const definition of sceneDefinitions) {
      if (this.scenes.has(definition.id)) {
        throw new Error(`Duplicate commercial scene '${definition.id}'.`);
      }
      this.scenes.set(definition.id, definition);
    }
    for (const id of COMMERCIAL_SCENE_IDS) {
      if (!this.scenes.has(id)) throw new Error(`Missing commercial scene '${id}'.`);
    }
    for (const scene of this.scenes.values()) {
      const fallback = this.scenes.get(scene.fallback.sceneId);
      if (!fallback?.variants.some((variant) => variant.id === scene.fallback.variantId)) {
        throw new Error(
          `Invalid fallback '${scene.fallback.sceneId}/${scene.fallback.variantId}' for '${scene.id}'.`,
        );
      }
    }
  }

  get(id: CommercialSceneId): CommercialSceneDefinition {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error(`Unknown commercial scene '${id}'.`);
    return scene;
  }

  getVariant(sceneId: CommercialSceneId, variantId: string): CommercialSceneVariantDefinition {
    const scene = this.get(sceneId);
    const variant = scene.variants.find((candidate) => candidate.id === variantId);
    if (!variant) throw new Error(`Unknown commercial variant '${sceneId}/${variantId}'.`);
    return variant;
  }

  getAll(): CommercialSceneDefinition[] {
    return [...this.scenes.values()].sort((left, right) => left.order - right.order);
  }
}

export const commercialSceneRegistry = new CommercialSceneRegistry();
