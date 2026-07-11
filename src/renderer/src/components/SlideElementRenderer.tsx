import React from "react";
import type { SlideElement } from "@shared/presentation";
import { fontFamilyToCss, resolveElementFontFamily } from "@shared/typography";
import { resolveImageTreatment, type ResolvedSlideStyle } from "@design-system";
import { ShapeElementView } from "./ShapeElementView";
import { ChartElementView } from "./ChartElementView";
import { TableElementView } from "./TableElementView";
import { IconElementView } from "./IconElementView";

export interface SlideElementRendererProps {
  element: SlideElement;
  style: ResolvedSlideStyle;
}

export function SlideElementRenderer({
  element,
  style,
}: SlideElementRendererProps) {
  if (element.type === "text") {
    return (
      <p
        style={{
          fontSize: element.fontSize,
          color: element.color || style.colors.body,
          fontWeight: element.bold ? "bold" : "normal",
          textAlign: element.align || "left",
          fontFamily: fontFamilyToCss(resolveElementFontFamily(element, style.typography.family)),
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
    const treatment = resolveImageTreatment(
      element.imageTreatment,
      style.image.treatment,
      element.borderRadius,
      style.colors,
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
        defaultAccent={style.colors.accent}
        defaultStyle={style.chart.style}
        textColor={style.colors.body}
      />
    );
  }

  if (element.type === "table") {
    return (
      <TableElementView
        element={element}
        headerBg={style.colors.cardBg}
        stripeBg={style.colors.cardStroke}
        textColor={style.colors.body}
        borderColor={style.colors.cardStroke}
      />
    );
  }

  if (element.type === "icon") {
    return <IconElementView element={element} defaultColor={style.colors.accent} />;
  }

  return null;
}
