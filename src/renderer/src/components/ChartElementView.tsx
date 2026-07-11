import type { ChartElement } from "@shared/presentation";
import type { ChartStyle } from "@shared/design-tokens";
import { chartDataToSvgString, chartSvgToDataUri } from "@shared/chart-utils";

interface ChartElementViewProps {
  element: ChartElement;
  defaultAccent?: string;
  defaultStyle?: ChartStyle;
  textColor?: string;
}

export function ChartElementView({
  element,
  defaultAccent = "#0ea5e9",
  defaultStyle = "minimal",
  textColor = "#475569",
}: ChartElementViewProps) {
  const svg = chartDataToSvgString(element, defaultAccent, defaultStyle, textColor);
  return (
    <img
      src={chartSvgToDataUri(svg)}
      alt=""
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  );
}
