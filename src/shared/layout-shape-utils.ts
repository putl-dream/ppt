import type { ShapeElement, SlideElement } from "./presentation";

/** Prefixes used by applyLayout-generated decorative shapes. */
export const LAYOUT_SHAPE_PREFIXES = [
  "card-",
  "accent-",
  "badge-",
  "arrow-",
  "num-",
  "deco-",
] as const;

export function isLayoutGeneratedShape(element: SlideElement): boolean {
  return (
    element.type === "shape" &&
    LAYOUT_SHAPE_PREFIXES.some((prefix) => element.id.startsWith(prefix))
  );
}

export function isLayoutCard(element: SlideElement): boolean {
  return (
    element.type === "shape" &&
    (element.shapeType === "rectangle" || element.shapeType === "roundedRect") &&
    element.id.startsWith("card-")
  );
}

/** Shapes added by the user (not layout-generated cards/badges). */
export function isUserPreservedShape(element: SlideElement): element is ShapeElement {
  if (element.type !== "shape") return false;
  if (isLayoutGeneratedShape(element)) return false;
  if (element.shapeType === "rectangle" || element.shapeType === "roundedRect") return false;
  return true;
}
