import { describe, expect, it } from "vitest";
import { renderElementHtml } from "../src/shared/slide-html-render";
import type { ShapeElement } from "../src/shared/presentation";
import {
  shapeBorderRadius,
  shapeBoxShadow,
  shapeFillColor,
} from "../src/shared/shape-render-utils";

const baseShape: ShapeElement = {
  id: "shape-1",
  type: "shape",
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  shapeType: "rectangle",
  fillColor: "#3b82f6",
  strokeColor: "#1d4ed8",
};

describe("shape visual vocabulary", () => {
  it("applies corner radius for roundedRect", () => {
    const shape: ShapeElement = {
      ...baseShape,
      shapeType: "roundedRect",
      cornerRadius: 12,
    };
    expect(shapeBorderRadius(shape)).toBe("12px");
  });

  it("applies fill opacity via rgba", () => {
    const shape: ShapeElement = { ...baseShape, fillOpacity: 0.5 };
    expect(shapeFillColor(shape)).toBe("rgba(59,130,246,0.5)");
  });

  it("renders box-shadow in HTML output", () => {
    const shape: ShapeElement = {
      ...baseShape,
      shapeType: "roundedRect",
      cornerRadius: 12,
      shadow: { color: "#000000", blur: 16, offsetX: 0, offsetY: 4, opacity: 0.1 },
    };
    expect(shapeBoxShadow(shape)).toContain("4px");
    const html = renderElementHtml(shape, "nordic");
    expect(html).toContain("box-shadow:");
    expect(html).toContain("border-radius:12px");
  });

  it("renders fill transparency in HTML", () => {
    const shape: ShapeElement = {
      ...baseShape,
      fillOpacity: 0.2,
    };
    const html = renderElementHtml(shape, "nordic");
    expect(html).toContain("rgba(59,130,246,0.2)");
  });
});
