import React from "react";
import type { SlideElement } from "@shared/presentation";
import { fontFamilyToCss, resolveElementFontFamily } from "@shared/typography";
import { ShapeElementView } from "./ShapeElementView";
import { ChartElementView } from "./ChartElementView";
import { TableElementView } from "./TableElementView";
import { IconElementView } from "./IconElementView";

export interface SlideElementRendererProps {
  element: SlideElement;
  theme: string;
  bodyColor?: string;
  accentColor?: string;
  cardBg?: string;
  cardStroke?: string;
}

export function SlideElementRenderer({
  element,
  theme,
  bodyColor = "#475569",
  accentColor = "#0ea5e9",
  cardBg = "#f8fafc",
  cardStroke = "#e2e8f0",
}: SlideElementRendererProps) {
  if (element.type === "text") {
    return (
      <p
        style={{
          fontSize: element.fontSize,
          color: element.color || bodyColor,
          fontWeight: element.bold ? "bold" : "normal",
          textAlign: element.align || "left",
          fontFamily: fontFamilyToCss(resolveElementFontFamily(element, theme)),
          margin: 0,
          lineHeight: 1.4,
          whiteSpace: "pre-wrap",
          width: "100%",
        }}
      >
        {element.text}
      </p>
    );
  }

  if (element.type === "image") {
    return (
      <img
        src={element.url}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: element.objectFit || "cover",
          borderRadius: `${element.borderRadius || 0}px`,
        }}
      />
    );
  }

  if (element.type === "shape") {
    return <ShapeElementView element={element} />;
  }

  if (element.type === "chart") {
    return <ChartElementView element={element} defaultAccent={accentColor} />;
  }

  if (element.type === "table") {
    return (
      <TableElementView
        element={element}
        headerBg={cardBg}
        stripeBg={cardStroke}
        textColor={bodyColor}
        borderColor={cardStroke}
      />
    );
  }

  if (element.type === "icon") {
    return <IconElementView element={element} defaultColor={accentColor} />;
  }

  return null;
}
