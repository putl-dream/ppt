import type { ShapeElement } from "./presentation";

/** Blend hex color with alpha for CSS rgba(). */
export function colorWithOpacity(color: string, opacity: number): string {
  const clean = color.replace("#", "");
  const hex =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.slice(0, 6);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function shapeFillColor(element: ShapeElement): string {
  const fill = element.fillColor || "#3b82f6";
  if (element.fillOpacity != null && element.fillOpacity < 1) {
    return colorWithOpacity(fill, element.fillOpacity);
  }
  return fill;
}

export function shapeBorderRadius(element: ShapeElement): string {
  if (element.shapeType === "circle") return "50%";
  if (element.shapeType === "roundedRect" || element.cornerRadius != null) {
    return `${element.cornerRadius ?? 8}px`;
  }
  return "0";
}

export function shadowToBoxShadow(
  shadow: NonNullable<ShapeElement["shadow"]>,
): string {
  const color = colorWithOpacity(shadow.color, shadow.opacity);
  return `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${color}`;
}

export function shapeBoxShadow(element: ShapeElement): string | undefined {
  if (!element.shadow) return undefined;
  return shadowToBoxShadow(element.shadow);
}
