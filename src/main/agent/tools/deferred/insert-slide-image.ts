import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import type { ImageAssetMetadata, ImageElement } from "@shared/presentation";
import { LayoutPolicy } from "../../design/layout-policy";
import { localizeImageAsset } from "../../assets/image-asset";
import {
  getLayoutSlotRect,
  listLayoutSlots,
  type AspectRatioPreset,
} from "@shared/layout-slots";

export const insertSlideImageSchema = z.object({
  slideId: z.string().describe("幻灯片 ID"),
  url: z.string().describe("图片 URL 或本地路径"),
  slot: z.string().describe("layout 槽位名，如 side、hero、grid-0"),
  aspectRatio: z
    .enum(["16:9", "4:3", "1:1", "auto"])
    .optional()
    .describe("可选宽高比约束"),
  objectFit: z.enum(["cover", "contain"]).optional(),
  localize: z.boolean().optional()
    .describe("远程图片是否下载到 workspace；默认 true，保证 PPTX 可导出"),
  provider: z.string().max(100).optional(),
  source_page_url: z.string().url().optional(),
  description: z.string().max(600).optional(),
  attribution: z.string().max(300).optional(),
  license: z.string().max(200).optional(),
});

/**
 * Deferred Tool: 将图片插入 layout 预留槽位，无需手填坐标。
 */
export const insertSlideImageTool: ToolDefinition<
  typeof insertSlideImageSchema,
  { commands: PresentationCommand[]; warnings: string[]; asset?: ImageAssetMetadata }
> = {
  name: "InsertSlideImage",
  description: "将图片放入当前页 layout 槽位（side/hero/grid-N），自动计算坐标与比例。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: insertSlideImageSchema,
  risk: "medium",
  execute: async (args, context) => {
    const warnings: string[] = [];
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) return { commands: [], warnings: ["Slide not found."] };

    const layout = slide.layout ?? "concept";
    const validSlots = listLayoutSlots(layout);
    if (validSlots.length === 0) {
      return {
        commands: [],
        warnings: [`Layout '${layout}' has no image slots. Use concept, case, cover, or image-grid.`],
      };
    }

    if (!validSlots.includes(args.slot)) {
      return {
        commands: [],
        warnings: [`Slot '${args.slot}' invalid for layout '${layout}'. Valid: ${validSlots.join(", ")}`],
      };
    }

    const rect = getLayoutSlotRect(
      layout,
      args.slot,
      (args.aspectRatio ?? "auto") as AspectRatioPreset,
    );
    if (!rect) {
      return { commands: [], warnings: [`Could not resolve slot '${args.slot}'.`] };
    }

    if (!LayoutPolicy.isWithinSafeZone(rect)) {
      warnings.push("Computed slot rect extends outside the canvas safe zone.");
    }

    let effectiveUrl = args.url;
    let asset: ImageAssetMetadata | undefined;
    const isRemote = /^https?:\/\//i.test(args.url);
    if (isRemote && args.localize !== false) {
      if (!context.workspaceRoot) {
        warnings.push("Remote image was not localized because workspaceRoot is unavailable; PPTX export may fail.");
      } else {
        try {
          const localized = await localizeImageAsset({
            url: args.url,
            workspaceRoot: context.workspaceRoot,
            provider: args.provider,
            sourcePageUrl: args.source_page_url,
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
          return {
            commands: [],
            warnings: [`Unable to localize remote image: ${error instanceof Error ? error.message : String(error)}`],
          };
        }
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
