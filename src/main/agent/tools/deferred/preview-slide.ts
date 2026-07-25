import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type {
  ImageAssetMetadata,
  ImageElement,
  ShapeElement,
  Slide,
  TextElement,
} from "@shared/presentation";
import { resolveSlideStyle, type SlideDesignOverride } from "@design-system";
import { listLayoutSlots } from "@shared/layout-slots";
import { fontFamilyToCss } from "@shared/typography";
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
  svgPage?: {
    sourcePath: string;
    sha256: string;
    width: 1280;
    height: 720;
    resourceCount: number;
  };
  narrative?: Slide["narrative"];
  layout?: string;
  grammarVariant?: string;
  designOverride?: SlideDesignOverride;
  resolvedDesign: Pick<
    ReturnType<typeof resolveSlideStyle>,
    "argumentMode" | "visualStyle" | "readingMode" | "layoutTokens" | "typography"
  >;
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
  }>;
  images: Array<{
    id: string;
    url: string;
    imageSlot?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    asset?: ImageAssetMetadata;
  }>;
  shapeCount: number;
  chartCount: number;
  tableCount: number;
  iconCount: number;
  description: string;
}

function describeSlide(slide: Slide): string {
  if (slide.visualSource?.kind === "svg") {
    return [
      "Complete-page SVG",
      `${slide.visualSource.width}×${slide.visualSource.height}`,
      `source=${slide.visualSource.sourcePath}`,
      `sha256=${slide.visualSource.sha256.slice(0, 12)}`,
      `rhythm=${slide.narrative?.rhythm ?? "unset"}`,
    ].join(" · ");
  }

  const texts = slide.elements.filter((el): el is TextElement => el.type === "text");
  const images = slide.elements.filter((el): el is ImageElement => el.type === "image");
  const shapes = slide.elements.filter((el): el is ShapeElement => el.type === "shape");
  const cardCount = shapes.filter((el) => el.id.startsWith("card-")).length;
  const shadowCount = shapes.filter((el) => el.shadow).length;
  const roundedCount = shapes.filter(
    (el) => el.shapeType === "roundedRect" || el.cornerRadius != null,
  ).length;

  const parts = [
    `Layout: ${slide.layout ?? "unset"}${slide.grammarVariant ? `/${slide.grammarVariant}` : ""}`,
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
  {
    preview: SlidePreviewSummary;
    thumbnail: SlidePreviewThumbnail | null;
    thumbnailError?: string;
  }
> = {
  name: "PreviewSlide",
  description: "获取单页幻灯片的视觉摘要（layout、槽位、元素位置、背景）及 PNG 缩略图，用于排版后自检。",
  category: "core",
  loadPolicy: "core",
  inputSchema: previewSlideSchema,
  mapResultToModelBlocks: (result) => {
    const summary = {
      slideId: result.preview.slideId,
      title: result.preview.title,
      description: result.preview.description,
      svgPage: result.preview.svgPage,
      narrative: result.preview.narrative,
      layout: result.preview.layout,
      grammarVariant: result.preview.grammarVariant,
      elementCounts: {
        text: result.preview.textElements.length,
        image: result.preview.images.length,
        shape: result.preview.shapeCount,
        chart: result.preview.chartCount,
        table: result.preview.tableCount,
        icon: result.preview.iconCount,
      },
      thumbnail: result.thumbnail
        ? { width: result.thumbnail.width, height: result.thumbnail.height }
        : null,
      thumbnailError: result.thumbnailError,
    };
    return [
      { type: "text", text: JSON.stringify(summary) },
      ...(result.thumbnail
        ? [{
            type: "image" as const,
            mediaType: result.thumbnail.mimeType,
            data: result.thumbnail.pngBase64,
          }]
        : []),
    ];
  },
  behavior: {
    background: {
      isRequested: (args) => args.run_in_background === true,
      describe: (args) => `PreviewSlide: ${args.slideId}`,
    },
  },
  risk: "low",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) throw new Error(`Slide '${args.slideId}' was not found.`);

    const style = resolveSlideStyle(context.presentation.designSystem, slide);

    const preview: SlidePreviewSummary = {
      slideId: slide.id,
      title: slide.title,
      ...(slide.visualSource?.kind === "svg"
        ? {
            svgPage: {
              sourcePath: slide.visualSource.sourcePath,
              sha256: slide.visualSource.sha256,
              width: slide.visualSource.width,
              height: slide.visualSource.height,
              resourceCount: slide.visualSource.resources.length,
            },
            narrative: slide.narrative,
          }
        : {}),
      layout: slide.layout,
      grammarVariant: slide.grammarVariant,
      designOverride: slide.designOverride,
      resolvedDesign: {
        argumentMode: style.argumentMode,
        visualStyle: style.visualStyle,
        readingMode: style.readingMode,
        layoutTokens: style.layoutTokens,
        typography: style.typography,
      },
      backgroundVariant: slide.backgroundVariant ?? "default",
      slideVariant: slide.slideVariant,
      backgroundCss: style.background.css,
      imageSlots: listLayoutSlots(slide.layout ?? "", slide.grammarVariant),
      textElements: slide.elements
        .filter((el): el is TextElement => el.type === "text")
        .map((el) => {
          const roleTypography = el.textRole === "metric"
            ? style.typography.data
            : el.textRole === "kicker"
              ? style.typography.heading
              : style.typography.body;
          const fontFamily = el.fontFamily ?? roleTypography.family;
          return {
            id: el.id,
            text: el.text,
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
      description: describeSlide(slide),
    };

    let thumbnail: SlidePreviewThumbnail | null = null;
    let thumbnailError: string | undefined;
    if (args.includeThumbnail) {
      try {
        thumbnail = await slideThumbnailService.captureSlide(slide, context.presentation.designSystem);
      } catch (error) {
        thumbnail = null;
        thumbnailError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      preview,
      thumbnail,
      ...(thumbnailError ? { thumbnailError } : {}),
    };
  },
};
