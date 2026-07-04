import type { SlideLayoutType } from "./slide-layouts";

export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AspectRatioPreset = "16:9" | "4:3" | "1:1" | "auto";

const CONTENT_Y = 200;
const CONTENT_H = 430;

function fitAspectRatio(
  rect: SlotRect,
  aspect: AspectRatioPreset,
): SlotRect {
  if (aspect === "auto") return rect;

  const [wRatio, hRatio] =
    aspect === "16:9"
      ? [16, 9]
      : aspect === "4:3"
        ? [4, 3]
        : [1, 1];
  const targetRatio = wRatio / hRatio;
  const currentRatio = rect.width / rect.height;

  if (currentRatio > targetRatio) {
    const newWidth = rect.height * targetRatio;
    const dx = (rect.width - newWidth) / 2;
    return { ...rect, x: rect.x + dx, width: newWidth };
  }

  const newHeight = rect.width / targetRatio;
  const dy = (rect.height - newHeight) / 2;
  return { ...rect, y: rect.y + dy, height: newHeight };
}

/** Slot rectangles aligned with applyLayout placement logic. */
export function getLayoutSlotRect(
  layout: SlideLayoutType | string,
  slot: string,
  aspectRatio: AspectRatioPreset = "auto",
): SlotRect | undefined {
  let rect: SlotRect | undefined;

  if (layout === "cover" && slot === "hero") {
    rect = { x: 200, y: 500, width: 880, height: 160 };
  } else if (layout === "case" && slot === "side") {
    rect = { x: 784, y: 224, width: 352, height: 382 };
  } else if (layout === "concept" && /^grid-\d+$/.test(slot)) {
    const idx = Number(slot.slice(5));
    const N = 4;
    const cardGap = 24;
    const totalW = 1040;
    const colW = (totalW - (N - 1) * cardGap) / N;
    const colX = 120 + idx * (colW + cardGap);
    const imageAreaH = 100;
    rect = {
      x: colX + 20,
      y: CONTENT_Y + CONTENT_H - imageAreaH - 16,
      width: colW - 40,
      height: imageAreaH,
    };
  } else if (layout === "image-grid" && /^grid-\d+$/.test(slot)) {
    const idx = Number(slot.slice(5));
    rect = getImageGridSlotRect(idx, 4);
  } else if (layout === "image-grid" && slot === "hero") {
    rect = { x: 120, y: CONTENT_Y, width: 1040, height: CONTENT_H };
  }

  if (!rect) return undefined;
  return fitAspectRatio(rect, aspectRatio);
}

export function getImageGridSlotRect(index: number, count: number): SlotRect | undefined {
  const pad = 12;
  const gap = 16;
  const area = { x: 120, y: CONTENT_Y, width: 1040, height: CONTENT_H };

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

  // 4-up grid
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

export function listLayoutSlots(layout: SlideLayoutType | string): string[] {
  switch (layout) {
    case "cover":
      return ["hero"];
    case "case":
      return ["side"];
    case "concept":
      return ["grid-0", "grid-1", "grid-2", "grid-3"];
    case "image-grid":
      return ["grid-0", "grid-1", "grid-2", "grid-3", "hero"];
    default:
      return [];
  }
}
