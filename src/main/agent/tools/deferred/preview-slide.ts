import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type {
  ImageAssetMetadata,
  ImageElement,
  ShapeElement,
  Slide,
  TextElement,
} from "@shared/presentation";
import { resolveSlideBackgroundWithVariant } from "@shared/slide-variant";
import { listLayoutSlots } from "@shared/layout-slots";
import { fontFamilyToCss, resolveElementFontFamily } from "@shared/typography";
import { slideThumbnailService } from "../../../deck/slide-thumbnail-service";

export const previewSlideSchema = z.object({
  slideId: z.string().describe("要预览的幻灯片 ID"),
  includeThumbnail: z
    .boolean()
    .optional()
    .default(true)
    .describe("是否生成 PNG 缩略图（640×360 base64）；非 Electron 环境自动跳过"),
  run_in_background: z.boolean().optional().describe(
    "Run thumbnail generation in the background; result returns later as task_notification.",
  ),
});

export interface SlidePreviewThumbnail {
  pngBase64: string;
  width: number;
  height: number;
  mimeType: "image/png";
}

export interface SlidePreviewSummary {
  slideId: string;
  title: string;
  layout?: string;
  backgroundVariant: string;
  slideVariant?: string;
  backgroundCss: string;
  imageSlots: string[];
  textElements: Array<{
    id: string;
    text: string;
    textRole?: string;
    fontFamily: string;
    fontCss: string;
    x: number;
    y: number;
    width: number;
    height: number;
    asset?: ImageAssetMetadata;
  }>;
  images: Array<{
    id: string;
    url: string;
    imageSlot?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  shapeCount: number;
  chartCount: number;
  tableCount: number;
  iconCount: number;
  description: string;
}

function describeSlide(slide: Slide, _theme: string): string {
  const texts = slide.elements.filter((el): el is TextElement => el.type === "text");
  const images = slide.elements.filter((el): el is ImageElement => el.type === "image");
  const shapes = slide.elements.filter((el): el is ShapeElement => el.type === "shape");
  const cardCount = shapes.filter((el) => el.id.startsWith("card-")).length;
  const shadowCount = shapes.filter((el) => el.shadow).length;
  const roundedCount = shapes.filter(
    (el) => el.shapeType === "roundedRect" || el.cornerRadius != null,
  ).length;

  const parts = [
    `Layout: ${slide.layout ?? "unset"}`,
    `${texts.length} text, ${images.length} image, ${shapes.length} shape`,
  ];
  if (cardCount > 0) parts.push(`${cardCount} cards`);
  if (shadowCount > 0) parts.push(`${shadowCount} shadow`);
  if (roundedCount > 0) parts.push(`${roundedCount} rounded`);
  if (slide.layout === "case") {
    const metric = texts.find((el) => el.textRole === "metric");
    if (metric) parts.push(`KPI: ${metric.text}`);
  }
  return parts.join(" · ");
}

/**
 * Core Tool: 返回幻灯片结构化视觉摘要，供 Agent 排版后自检。
 * P2-2：从 Deferred 提升为 Core，layout/review 阶段可直接调用。
 */
export const previewSlideTool: ToolDefinition<
  typeof previewSlideSchema,
  { preview: SlidePreviewSummary | null; thumbnail: SlidePreviewThumbnail | null }
> = {
  name: "PreviewSlide",
  description: "获取单页幻灯片的视觉摘要（layout、槽位、元素位置、背景）及 PNG 缩略图，用于排版后自检。",
  category: "core",
  loadPolicy: "core",
  inputSchema: previewSlideSchema,
  risk: "low",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) return { preview: null, thumbnail: null };

    const theme = context.presentation.theme || "nordic";
    const palette = context.presentation.palette || "cyan";
    const bg = resolveSlideBackgroundWithVariant(theme, palette, slide);

    const preview: SlidePreviewSummary = {
      slideId: slide.id,
      title: slide.title,
      layout: slide.layout,
      backgroundVariant: slide.backgroundVariant ?? "default",
      slideVariant: slide.slideVariant,
      backgroundCss: bg.slideBg,
      imageSlots: listLayoutSlots(slide.layout ?? ""),
      textElements: slide.elements
        .filter((el): el is TextElement => el.type === "text")
        .map((el) => {
          const fontFamily = resolveElementFontFamily(el, theme);
          return {
            id: el.id,
            text: el.text.slice(0, 80),
            textRole: el.textRole,
            fontFamily,
            fontCss: fontFamilyToCss(fontFamily),
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
          };
        }),
      images: slide.elements
        .filter((el): el is ImageElement => el.type === "image")
        .map((el) => ({
          id: el.id,
          url: el.url,
          imageSlot: el.imageSlot,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          asset: el.asset,
        })),
      shapeCount: slide.elements.filter((el) => el.type === "shape").length,
      chartCount: slide.elements.filter((el) => el.type === "chart").length,
      tableCount: slide.elements.filter((el) => el.type === "table").length,
      iconCount: slide.elements.filter((el) => el.type === "icon").length,
      description: describeSlide(slide, theme),
    };

    let thumbnail: SlidePreviewThumbnail | null = null;
    if (args.includeThumbnail) {
      try {
        thumbnail = await slideThumbnailService.captureSlide(slide, theme, palette);
      } catch {
        thumbnail = null;
      }
    }

    return { preview, thumbnail };
  },
};
