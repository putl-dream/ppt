import type { ShapeElement } from "@shared/presentation";

interface ShapeElementViewProps {
  element: ShapeElement;
}

export function ShapeElementView({ element }: ShapeElementViewProps) {
  const fill = element.fillColor || "#3b82f6";
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
        style={{ display: "block", pointerEvents: "none" }}
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
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: fill,
          border: `2px solid ${stroke}`,
          borderRadius: "50%",
          pointerEvents: "none",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: fill,
        border: `2px solid ${stroke}`,
        borderRadius: 0,
        pointerEvents: "none",
      }}
    />
  );
}
