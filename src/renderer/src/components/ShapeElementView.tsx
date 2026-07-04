import type { CSSProperties } from "react";
import type { ShapeElement } from "@shared/presentation";
import {
  shapeBorderRadius,
  shapeBoxShadow,
  shapeFillColor,
} from "@shared/shape-render-utils";

interface ShapeElementViewProps {
  element: ShapeElement;
}

function rectStyle(element: ShapeElement): CSSProperties {
  const fill = shapeFillColor(element);
  const stroke = element.strokeColor || "#1d4ed8";
  const boxShadow = shapeBoxShadow(element);
  const hasVisibleStroke =
    element.strokeColor &&
    element.strokeColor !== "transparent" &&
    element.strokeColor !== fill;

  return {
    width: "100%",
    height: "100%",
    backgroundColor: fill,
    border: hasVisibleStroke ? `2px solid ${stroke}` : "none",
    borderRadius: shapeBorderRadius(element),
    boxShadow,
    pointerEvents: "none",
  };
}

export function ShapeElementView({ element }: ShapeElementViewProps) {
  const fill = shapeFillColor(element);
  const stroke = element.strokeColor || "#1d4ed8";

  if (element.shapeType === "line") {
    const strokeWidth = Math.max(2, element.height * 0.6);
    return (
      <svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ display: "block", pointerEvents: "none" }}
      >
        <line
          x1="0"
          y1="50%"
          x2="100%"
          y2="50%"
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </svg>
    );
  }

  if (element.shapeType === "arrow") {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
        style={{ display: "block", pointerEvents: "none", filter: shapeBoxShadow(element) ? `drop-shadow(${shapeBoxShadow(element)})` : undefined }}
      >
        <path
          d="M 0 15 L 62 15 L 62 5 L 100 25 L 62 45 L 62 35 L 0 35 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth={1}
        />
      </svg>
    );
  }

  if (element.shapeType === "circle") {
    return <div style={rectStyle(element)} />;
  }

  return <div style={rectStyle(element)} />;
}
