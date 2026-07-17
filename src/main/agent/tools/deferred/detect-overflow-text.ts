import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { estimateTextWidthUnits } from "@shared/layout";

/** Smallest fontSize the renderers/fit logic will step down to. */
const MIN_FONT_SIZE = 12;
/** Matches the renderers' line-height and applyLayout's fitFontSize model. */
const LINE_HEIGHT = 1.4;

/**
 * True when `text` cannot fit inside a boxW × boxH box even at MIN_FONT_SIZE.
 * Mirrors fitFontSize / renderer geometry (pre-wrap + line-height 1.4), so it
 * flags genuine visual overflow rather than a flat character count.
 */
function overflowsAtMinSize(text: string, boxW: number, boxH: number): boolean {
  if (!text.trim() || boxW <= 0 || boxH <= 0) return false;
  const unitsPerLine = boxW / MIN_FONT_SIZE;
  if (unitsPerLine <= 0) return true;
  const maxLines = Math.max(1, Math.floor(boxH / (MIN_FONT_SIZE * LINE_HEIGHT)));
  let linesNeeded = 0;
  for (const paragraph of text.split("\n")) {
    const units = estimateTextWidthUnits(paragraph);
    linesNeeded += Math.max(1, Math.ceil(units / unitsPerLine));
  }
  return linesNeeded > maxLines;
}

export const detectOverflowTextSchema = z.object({
  slideId: z.string().optional().describe("指定检查的幻灯片 ID，若为空则检查整套 PPT"),
});

interface OverflowElement {
  slideId: string;
  elementId: string;
  currentLength: number;
  boxWidth: number;
  boxHeight: number;
  reason: string;
}

/**
 * Deferred Tool: 检查幻灯片中是否存在文本框内容溢出。
 * 几何感知：以 box 宽高 + 最小字号估算，只有真正放不下才报溢出。
 */
export const detectOverflowTextTool: ToolDefinition<
  typeof detectOverflowTextSchema,
  { overflowElements: OverflowElement[] }
> = {
  name: "DetectOverflowText",
  description:
    "按文本框实际宽高与最小字号几何估算，检查是否存在即使缩字仍无法容纳的溢出文本。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: detectOverflowTextSchema,
  risk: "low",
  execute: async (args, context) => {
    const overflowElements: OverflowElement[] = [];
    if (
      args.slideId
      && !context.presentation.slides.some((slide) => slide.id === args.slideId)
    ) {
      throw new Error(`Slide '${args.slideId}' was not found.`);
    }
    const targetSlides = args.slideId
      ? context.presentation.slides.filter((s) => s.id === args.slideId)
      : context.presentation.slides;

    for (const slide of targetSlides) {
      for (const el of slide.elements) {
        if (el.type !== "text") continue;
        if (!overflowsAtMinSize(el.text, el.width, el.height)) continue;
        overflowElements.push({
          slideId: slide.id,
          elementId: el.id,
          currentLength: el.text.length,
          boxWidth: el.width,
          boxHeight: el.height,
          reason: `即使缩到 ${MIN_FONT_SIZE}px 仍无法在 ${Math.round(el.width)}×${Math.round(el.height)} 框内容纳，需拆条或拆页`,
        });
      }
    }

    return { overflowElements };
  },
};
