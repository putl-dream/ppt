import type { Slide } from "./presentation";
import type { SlideLayoutType } from "./slide-layouts";

export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CONTENT_Y = 200;
const CONTENT_H = 430;
const GRID_SLOTS = ["grid-0", "grid-1", "grid-2", "grid-3"] as const;

/**
 * Reads the rectangle that the active grammar handler actually assigned to an
 * image slot. Empty slots intentionally have no speculative geometry.
 */
export function getLayoutSlotRect(
  laidOutSlide: Pick<Slide, "elements">,
  slot: string,
): SlotRect | undefined {
  const image = laidOutSlide.elements.find(
    (element) => element.type === "image" && element.imageSlot === slot,
  );
  if (!image || image.type !== "image") return undefined;
  return {
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
  };
}

/**
 * Shared geometry primitive used directly by the image-grid grammar handler.
 * This describes the grid card; the handler remains the sole owner of image
 * padding and caption-aware placement inside that card.
 */
export function getImageGridSlotRect(index: number, count: number): SlotRect | undefined {
  const gap = 16;
  const area = { x: 120, y: CONTENT_Y, width: 1040, height: CONTENT_H };

  if (index < 0 || index >= Math.min(Math.max(count, 1), 4)) {
    return undefined;
  }

  if (count <= 1) {
    return area;
  }

  if (count === 2) {
    const colW = (area.width - gap) / 2;
    return {
      x: area.x + index * (colW + gap),
      y: area.y,
      width: colW,
      height: area.height,
    };
  }

  if (count === 3) {
    if (index === 0) {
      return {
        x: area.x,
        y: area.y,
        width: area.width,
        height: (area.height - gap) / 2,
      };
    }
    const rowY = area.y + (area.height - gap) / 2 + gap;
    const colW = (area.width - gap) / 2;
    return {
      x: area.x + (index - 1) * (colW + gap),
      y: rowY,
      width: colW,
      height: (area.height - gap) / 2,
    };
  }

  const colW = (area.width - gap) / 2;
  const rowH = (area.height - gap) / 2;
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: area.x + col * (colW + gap),
    y: area.y + row * (rowH + gap),
    width: colW,
    height: rowH,
  };
}

export function listLayoutSlots(
  layout: SlideLayoutType | string,
  grammarVariant?: string,
): string[] {
  switch (layout) {
    case "cover":
      return ["hero"];
    case "section":
      return grammarVariant === "editorial-split" ? ["hero"] : [];
    case "case":
      return grammarVariant === "metric-focus" ? [] : ["side"];
    case "concept":
      if (grammarVariant === "statement-stack") return [];
      if (grammarVariant === "editorial-columns") return ["side"];
      return [...GRID_SLOTS];
    case "image-grid":
      if (grammarVariant === "hero-caption" || grammarVariant === undefined) {
        return ["hero", "grid-1", "grid-2", "grid-3"];
      }
      if (grammarVariant === "evidence-wall") {
        return ["grid-0", "grid-1", "grid-2"];
      }
      return [...GRID_SLOTS];
    default:
      return [];
  }
}
