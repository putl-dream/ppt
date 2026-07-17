import { z } from "zod";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import {
  imageSourceSchema,
  type ImageAssetMetadata,
  type ImageElement,
} from "@shared/presentation";
import { LayoutPolicy } from "../../design/layout-policy";
import { localizeImageAsset } from "../../assets/image-asset";
import { isOutsideWorkspace } from "../../subagent/workspace-path";
import {
  getLayoutSlotRect,
  listLayoutSlots,
  type AspectRatioPreset,
} from "@shared/layout-slots";

export const insertSlideImageSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  url: imageSourceSchema.describe("图片 URL、工作区内本地路径或受支持的图片 data URL"),
  slot: z.string().describe("layout 槽位名，如 side、hero、grid-0"),
  aspectRatio: z
    .enum(["16:9", "4:3", "1:1", "auto"])
    .optional()
    .describe("可选宽高比约束"),
  objectFit: z.enum(["cover", "contain"]).optional(),
  provider: z.string().max(100).optional(),
  sourcePageUrl: z.string().url().optional(),
  description: z.string().max(600).optional(),
  attribution: z.string().max(300).optional(),
  license: z.string().max(200).optional(),
});

/**
 * Core Tool: 将已选图片插入 layout 预留槽位，无需手填坐标。
 */
export const insertSlideImageTool: ToolDefinition<
  typeof insertSlideImageSchema,
  { commands: PresentationCommand[]; warnings: string[]; asset?: ImageAssetMetadata }
> = {
  name: "InsertSlideImage",
  description: "将 SearchSlideImages 选中的图片直接放入 layout 槽位（side/hero/grid-N），自动计算坐标、本地化并保留来源。无需 SearchExtraTools。",
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
  risk: "medium",
  execute: async (args, context) => {
    const warnings: string[] = [];
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) throw new Error(`Slide '${args.slideId}' was not found.`);

    const layout = slide.layout ?? "concept";
    const validSlots = listLayoutSlots(layout, slide.grammarVariant);
    if (validSlots.length === 0) {
      throw new Error(
        `Layout '${layout}' has no image slots. Use concept, case, cover, or image-grid.`,
      );
    }

    if (!validSlots.includes(args.slot)) {
      throw new Error(
        `Slot '${args.slot}' invalid for layout '${layout}'. Valid: ${validSlots.join(", ")}`,
      );
    }

    const rect = getLayoutSlotRect(
      layout,
      args.slot,
      (args.aspectRatio ?? "auto") as AspectRatioPreset,
      slide.grammarVariant,
    );
    if (!rect) {
      throw new Error(`Could not resolve slot '${args.slot}'.`);
    }

    if (!LayoutPolicy.isWithinSafeZone(rect)) {
      warnings.push("Computed slot rect extends outside the canvas safe zone.");
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
      (el): el is ImageElement => el.type === "image" && el.imageSlot === args.slot,
    );

    if (existing) {
      return {
        commands: [
          {
            id: crypto.randomUUID(),
            type: "update-element",
            slideId: args.slideId,
            elementId: existing.id,
            element: {
              ...existing,
              url: effectiveUrl,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              imageSlot: args.slot,
              objectFit: args.objectFit ?? existing.objectFit ?? "cover",
              provenance: "asset",
              asset: asset ?? existing.asset,
            },
          },
        ],
        warnings,
        ...(asset ? { asset } : {}),
      };
    }

    return {
      commands: [
        {
          id: crypto.randomUUID(),
          type: "add-element",
          slideId: args.slideId,
          element: {
            id: crypto.randomUUID(),
            type: "image",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            url: effectiveUrl,
            borderRadius: 4,
            imageSlot: args.slot,
            objectFit: args.objectFit ?? "cover",
            provenance: "asset",
            ...(asset ? { asset } : {}),
          },
        },
      ],
      warnings,
      ...(asset ? { asset } : {}),
    };
  },
};
