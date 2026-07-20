import type { ShapeElement, SlideElement } from "./presentation";

/** Prefixes used by applyLayout-generated decorative shapes. */
export const LAYOUT_SHAPE_PREFIXES = [
  "card-",
  "accent-",
  "badge-",
  "arrow-",
  "num-",
  "deco-",
  "motif-",
] as const;

export function isLayoutGeneratedShape(element: SlideElement): boolean {
  return (
    element.type === "shape" &&
    (element.provenance === "layout" ||
      LAYOUT_SHAPE_PREFIXES.some((prefix) => element.id.startsWith(prefix)))
  );
}

export function isLayoutCard(element: SlideElement): boolean {
  return (
    element.type === "shape" &&
    (element.shapeType === "rectangle" || element.shapeType === "roundedRect") &&
    element.id.startsWith("card-")
  );
}

function isCommercialLayoutCard(element: SlideElement): element is ShapeElement {
  return (
    element.type === "shape"
    && element.provenance === "layout"
    && element.shapeType === "roundedRect"
    && element.fillOpacity === undefined
    && element.width * element.height >= 40_000
  );
}

function contentIntersectionRatio(card: ShapeElement, content: SlideElement): number {
  const width = Math.max(
    0,
    Math.min(card.x + card.width, content.x + content.width) - Math.max(card.x, content.x),
  );
  const height = Math.max(
    0,
    Math.min(card.y + card.height, content.y + content.height) - Math.max(card.y, content.y),
  );
  return width * height / Math.max(1, content.width * content.height);
}

function isFullBleedImage(element: SlideElement): boolean {
  return element.type === "image"
    && element.width * element.height >= 1280 * 720 * 0.7;
}

export function findEmptyLayoutCards(elements: readonly SlideElement[]): ShapeElement[] {
  const foreground = elements.filter((element) =>
    element.type !== "shape" && !isFullBleedImage(element)
  );
  return elements.filter((element): element is ShapeElement =>
    isCommercialLayoutCard(element)
    && !foreground.some((candidate) => contentIntersectionRatio(element, candidate) >= 0.5)
  );
}

export function pruneEmptyLayoutCards(elements: readonly SlideElement[]): SlideElement[] {
  const emptyIds = new Set(findEmptyLayoutCards(elements).map((element) => element.id));
  return elements.filter((element) => !emptyIds.has(element.id));
}

/** Shapes added by the user (not layout-generated cards/badges). */
export function isUserPreservedShape(element: SlideElement): element is ShapeElement {
  if (element.type !== "shape") return false;
  if (isLayoutGeneratedShape(element)) return false;
  return true;
}
