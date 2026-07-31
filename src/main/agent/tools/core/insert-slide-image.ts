import { fileURLToPath } from "node:url";
import { z } from "zod";
import { resolveSlideStyle } from "@design-system";
import type { PresentationCommand } from "@shared/commands";
import { applyLayout } from "@shared/layout";
import { getLayoutSlotRect, listLayoutSlots } from "@shared/layout-slots";
import {
  imageSourceSchema,
  type ImageAssetMetadata,
  type ImageElement,
} from "@shared/presentation";
import { SLIDE_LAYOUTS, type SlideLayoutType } from "@shared/slide-layouts";
import { localizeImageAsset } from "../../assets/image-asset";
import { LayoutPolicy } from "../../design/layout-policy";
import { isOutsideWorkspace } from "../../subagent/workspace-path";
import type { ToolDefinition } from "../tool-definition";

const UNPLACED_COORDINATE = -10_000;

function isSlideLayout(value: string): value is SlideLayoutType {
  return (SLIDE_LAYOUTS as readonly string[]).includes(value);
}

export const insertSlideImageSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  url: imageSourceSchema.describe("图片 URL、工作区内本地路径或受支持的图片 data URL"),
  slot: z.string().describe("layout 槽位名，如 side、hero、grid-0"),
  aspectRatio: z
    .enum(["16:9", "4:3", "1:1", "auto"])
    .optional()
    .describe("图片搜索与选择时的宽高比偏好；最终坐标由 layout grammar 决定"),
  objectFit: z.enum(["cover", "contain"]).optional(),
  provider: z.string().max(100).optional(),
  sourcePageUrl: z.string().url().optional(),
  description: z.string().max(600).optional(),
  attribution: z.string().max(300).optional(),
  license: z.string().max(200).optional(),
});

/**
 * Core Tool: 将已选图片插入 layout 预留槽位，并由当前 grammar 重排整页。
 */
export const insertSlideImageTool: ToolDefinition<
  typeof insertSlideImageSchema,
  { commands: PresentationCommand[]; warnings: string[]; asset?: ImageAssetMetadata }
> = {
  name: "InsertSlideImage",
  description:
    "将 SearchSlideImages 选中的图片放入 layout 槽位（side/hero/grid-N），"
    + "本地化并以当前 grammarVariant 重排整页，最终坐标以 grammar handler 为准。",
  category: "core",
  loadPolicy: "core",
  inputSchema: insertSlideImageSchema,
  examples: [
    JSON.stringify({
      slideId: "slide-3",
      url: "https://images.example.com/photo.jpg",
      slot: "side",
      sourcePageUrl: "https://example.com/source",
      provider: "Pexels",
      description: "Industrial robot working on an assembly line",
    }),
  ],
  behavior: {
    presentation: {
      allowedCapabilities: ["edit", "restyle"],
    },
  },
  risk: "medium",
  execute: async (args, context) => {
    const warnings: string[] = [];
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) throw new Error(`Slide '${args.slideId}' was not found.`);

    const layout = slide.layout ?? "concept";
    if (!isSlideLayout(layout)) {
      throw new Error(`Layout '${layout}' is not registered.`);
    }
    const validSlots = listLayoutSlots(layout, slide.grammarVariant);
    if (validSlots.length === 0) {
      throw new Error(
        `Layout '${layout}/${slide.grammarVariant ?? "default"}' has no image slots. `
        + "Choose an image-capable grammar variant first.",
      );
    }
    if (!validSlots.includes(args.slot)) {
      throw new Error(
        `Slot '${args.slot}' invalid for layout '${layout}/${slide.grammarVariant ?? "default"}'. `
        + `Valid: ${validSlots.join(", ")}`,
      );
    }

    let effectiveUrl = args.url;
    let asset: ImageAssetMetadata | undefined;
    const isRemote = /^https?:\/\//i.test(args.url);
    const isDataImage = /^data:image\/(?:png|jpeg|gif);base64,/i.test(args.url);
    if (isRemote) {
      if (!context.workspaceRoot) {
        throw new Error("Remote images require a workspace root so they can be localized before insertion.");
      }
      try {
        const localized = await localizeImageAsset({
          url: args.url,
          workspaceRoot: context.workspaceRoot,
          provider: args.provider,
          sourcePageUrl: args.sourcePageUrl,
          description: args.description,
          attribution: args.attribution,
          license: args.license,
        });
        effectiveUrl = localized.fileUrl;
        asset = localized.metadata;
        if (!asset.sourcePageUrl || !asset.license) {
          warnings.push("Image was localized, but source page or license metadata is incomplete.");
        }
      } catch (error) {
        throw new Error(
          `Unable to localize remote image: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (!isDataImage) {
      if (!context.workspaceRoot) {
        throw new Error("Local image paths require a workspace root for sandbox validation.");
      }
      const localPath = /^file:\/\//i.test(args.url) ? fileURLToPath(args.url) : args.url;
      if (isOutsideWorkspace(context.workspaceRoot, localPath)) {
        throw new Error("Local image path is outside the workspace sandbox.");
      }
    }

    const existing = slide.elements.find(
      (element): element is ImageElement =>
        element.type === "image" && element.imageSlot === args.slot,
    );
    const imageId = existing?.id ?? crypto.randomUUID();
    const pendingImage: ImageElement = {
      ...existing,
      id: imageId,
      type: "image",
      x: UNPLACED_COORDINATE,
      y: UNPLACED_COORDINATE,
      width: 1,
      height: 1,
      url: effectiveUrl,
      borderRadius: existing?.borderRadius ?? 4,
      imageSlot: args.slot,
      objectFit: args.objectFit ?? existing?.objectFit ?? "cover",
      provenance: "asset",
      ...(asset || existing?.asset ? { asset: asset ?? existing?.asset } : {}),
    };
    const slideWithImage = {
      ...slide,
      elements: existing
        ? slide.elements.map((element) => element.id === existing.id ? pendingImage : element)
        : [...slide.elements, pendingImage],
    };
    const laidOutSlide = applyLayout(
      slideWithImage,
      layout,
      resolveSlideStyle(context.presentation.designSystem, slideWithImage),
      {
        grammarVariant: slide.grammarVariant,
        designOverride: slide.designOverride,
      },
    );
    const placedImage = laidOutSlide.elements.find(
      (element): element is ImageElement => element.type === "image" && element.id === imageId,
    );
    const rect = getLayoutSlotRect(laidOutSlide, args.slot);
    if (
      !placedImage
      || placedImage.imageSlot !== args.slot
      || placedImage.x === UNPLACED_COORDINATE
      || placedImage.y === UNPLACED_COORDINATE
      || !rect
    ) {
      throw new Error(
        `Layout grammar '${layout}/${slide.grammarVariant ?? "default"}' `
        + `did not consume image slot '${args.slot}'.`,
      );
    }

    if (!LayoutPolicy.isWithinSafeZone(rect)) {
      warnings.push("Grammar-assigned slot rect extends outside the canvas safe zone.");
    }

    return {
      commands: [{
        id: crypto.randomUUID(),
        type: "restore-slide",
        slide: laidOutSlide,
      }],
      warnings,
      ...(asset ? { asset } : {}),
    };
  },
};
