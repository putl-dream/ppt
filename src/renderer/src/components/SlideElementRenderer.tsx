import React from "react";
import type { SlideElement } from "@shared/presentation";
import { fontFamilyToCss, resolveElementFontFamily } from "@shared/typography";
import type { FontFamily } from "@shared/typography";
import type { ChartStyle, ImageTreatment } from "@shared/design-tokens";
import { resolveImageTreatmentStyle } from "@shared/image-treatment";
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
  fontFamily?: FontFamily;
  imageTreatment?: ImageTreatment;
  chartStyle?: ChartStyle;
}

export function SlideElementRenderer({
  element,
  theme,
  bodyColor = "#475569",
  accentColor = "#0ea5e9",
  cardBg = "#f8fafc",
  cardStroke = "#e2e8f0",
  fontFamily,
  imageTreatment = "plain",
  chartStyle = "minimal",
}: SlideElementRendererProps) {
  if (element.type === "text") {
    return (
      <p
        style={{
          fontSize: element.fontSize,
          color: element.color || bodyColor,
          fontWeight: element.bold ? "bold" : "normal",
          textAlign: element.align || "left",
          fontFamily: fontFamilyToCss(element.fontFamily ?? fontFamily ?? resolveElementFontFamily(element, theme)),
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
    const treatment = resolveImageTreatmentStyle(
      element,
      imageTreatment,
      { cardBg, cardStroke },
    );
    return (
      <img
        src={element.url}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: element.objectFit || "cover",
          borderRadius: `${treatment.borderRadius}px`,
          border: `${treatment.borderWidth}px solid ${treatment.borderColor}`,
          padding: treatment.padding,
          backgroundColor: treatment.backgroundColor,
          boxShadow: treatment.boxShadow,
          boxSizing: "border-box",
        }}
      />
    );
  }

  if (element.type === "shape") {
    return <ShapeElementView element={element} />;
  }

  if (element.type === "chart") {
    return (
      <ChartElementView
        element={element}
        defaultAccent={accentColor}
        defaultStyle={chartStyle}
        textColor={bodyColor}
      />
    );
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
