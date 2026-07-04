import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { Slide, TextElement, ImageElement } from "@shared/presentation";
import { resolveSlideBackground, resolveSlideBackgroundVariant } from "@shared/slide-background";
import { listLayoutSlots } from "@shared/layout-slots";
import { fontFamilyToCss, resolveElementFontFamily } from "@shared/typography";

export const previewSlideSchema = z.object({
  slideId: z.string().describe("要预览的幻灯片 ID"),
});

export interface SlidePreviewSummary {
  slideId: string;
  title: string;
  layout?: string;
  backgroundVariant: string;
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
  }>;
  shapeCount: number;
  description: string;
}

function describeSlide(slide: Slide, theme: string): string {
  const texts = slide.elements.filter((el): el is TextElement => el.type === "text");
  const images = slide.elements.filter((el): el is ImageElement => el.type === "image");
  const parts = [
    `Layout: ${slide.layout ?? "unset"}`,
    `${texts.length} text, ${images.length} image`,
  ];
  if (slide.layout === "case") {
    const metric = texts.find((el) => el.textRole === "metric");
    if (metric) parts.push(`KPI: ${metric.text}`);
  }
  return parts.join(" · ");
}

/**
 * Deferred Tool: 返回幻灯片结构化视觉摘要，供 Agent 排版后自检。
 */
export const previewSlideTool: ToolDefinition<
  typeof previewSlideSchema,
  { preview: SlidePreviewSummary | null }
> = {
  name: "PreviewSlide",
  description: "获取单页幻灯片的视觉摘要（layout、槽位、元素位置、背景），用于排版后自检。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: previewSlideSchema,
  risk: "low",
  execute: async (args, context) => {
    const slide = context.presentation.slides.find((item) => item.id === args.slideId);
    if (!slide) return { preview: null };

    const theme = context.presentation.theme || "nordic";
    const palette = context.presentation.palette || "cyan";
    const variant = resolveSlideBackgroundVariant(slide);
    const bg = resolveSlideBackground(theme, palette, variant);

    const preview: SlidePreviewSummary = {
      slideId: slide.id,
      title: slide.title,
      layout: slide.layout,
      backgroundVariant: variant,
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
        })),
      shapeCount: slide.elements.filter((el) => el.type === "shape").length,
      description: describeSlide(slide, theme),
    };

    return { preview };
  },
};
