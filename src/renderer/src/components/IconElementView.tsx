import type { IconElement } from "@shared/presentation";
import { resolveIconPath } from "@shared/icon-registry";

interface IconElementViewProps {
  element: IconElement;
  defaultColor?: string;
}

export function IconElementView({ element, defaultColor = "#0ea5e9" }: IconElementViewProps) {
  const path = resolveIconPath(element.name);
  const color = element.color ?? defaultColor;
  const strokeWidth = element.strokeWidth ?? 2;

  if (!path) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          opacity: 0.5,
        }}
      >
        ?
      </div>
    );
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", pointerEvents: "none" }}
    >
      <path d={path} />
    </svg>
  );
}
