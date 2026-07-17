import type { ChartElement } from "./presentation";
import type { ChartStyle } from "@design-system";
import { utf8ToBase64 } from "./base64";

interface ChartItem {
  label: string;
  value: number;
}

function normalizeChartData(element: ChartElement): ChartItem[] {
  const { data } = element;
  if (data.items?.length) {
    return data.items.filter((item) => Number.isFinite(item.value) && item.label.trim());
  }
  const labels = data.labels ?? [];
  const values = data.values ?? [];
  const length = Math.min(labels.length, values.length);
  return Array.from({ length }, (_, index) => ({
    label: labels[index],
    value: values[index],
  })).filter((item) => Number.isFinite(item.value) && item.label.trim());
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeHexColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function formatValue(value: number, unit: string | undefined): string {
  return `${Number.isInteger(value) ? value.toString() : value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    useGrouping: false,
  })}${unit ?? ""}`;
}

function fittedText(
  value: string,
  options: {
    x: number;
    y: number;
    width: number;
    fontSize: number;
    fill: string;
    anchor?: "start" | "middle" | "end";
    weight?: number;
  },
): string {
  const normalized = value.trim();
  const estimatedWidth = [...normalized].length * options.fontSize * 0.58;
  const fitAttributes = estimatedWidth > options.width
    ? ` textLength="${Math.max(1, options.width)}" lengthAdjust="spacingAndGlyphs"`
    : "";
  return `<text x="${options.x}" y="${options.y}" text-anchor="${options.anchor ?? "middle"}" font-size="${options.fontSize}"${options.weight ? ` font-weight="${options.weight}"` : ""} fill="${options.fill}"${fitAttributes}>${escapeXml(normalized)}</text>`;
}

function opacityForItem(
  index: number,
  highlightIndex: number | undefined,
  baseOpacity: number,
): number {
  if (highlightIndex === undefined) return baseOpacity;
  return index === highlightIndex ? 1 : Math.min(baseOpacity, 0.38);
}

function chartScale(items: ChartItem[]): {
  min: number;
  max: number;
  range: number;
} {
  const min = Math.min(0, ...items.map((item) => item.value));
  const max = Math.max(0, ...items.map((item) => item.value));
  return { min, max, range: Math.max(max - min, 1) };
}

function renderEmptyChart(textColor: string): string {
  return [
    `<rect x="1" y="1" width="98" height="98" rx="3" fill="none" stroke="${textColor}" stroke-width="0.6" stroke-dasharray="3 3" opacity="0.35"/>`,
    fittedText("No chart data", {
      x: 50,
      y: 52,
      width: 70,
      fontSize: 6,
      fill: textColor,
    }),
  ].join("");
}

function renderVerticalBars(
  element: ChartElement,
  items: ChartItem[],
  options: {
    accent: string;
    textColor: string;
    opacity: number;
    radius: number;
    showValues: boolean;
    tower: boolean;
    showBaseline: boolean;
  },
): string {
  const plotLeft = options.tower ? 10 : 7;
  const plotRight = options.tower ? 90 : 96;
  const plotTop = options.tower ? 9 : 8;
  const plotBottom = 84;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const slotWidth = plotWidth / items.length;
  const barWidth = Math.max(1.2, slotWidth * (options.tower ? 0.62 : 0.7));
  const scale = chartScale(items);
  const valueToY = (value: number) =>
    plotTop + ((scale.max - value) / scale.range) * plotHeight;
  const baselineY = valueToY(0);
  const labelFontSize = Math.max(2.1, Math.min(3.6, slotWidth * 0.34));
  const valueFontSize = Math.max(2.3, Math.min(4, slotWidth * 0.38));

  const bars = items.map((item, index) => {
    const centerX = plotLeft + slotWidth * index + slotWidth / 2;
    const valueY = valueToY(item.value);
    const barY = Math.min(baselineY, valueY);
    const barHeight = Math.max(0.7, Math.abs(baselineY - valueY));
    const itemOpacity = opacityForItem(index, element.highlightIndex, options.opacity);
    const valueYPosition = item.value >= 0
      ? Math.max(5, barY - 1.5)
      : Math.min(90, barY + barHeight + valueFontSize);
    const valueText = options.showValues || options.tower
      ? fittedText(formatValue(item.value, element.unit), {
          x: centerX,
          y: valueYPosition,
          width: Math.max(slotWidth - 1, 1),
          fontSize: valueFontSize,
          fill: options.accent,
          weight: index === element.highlightIndex || options.tower ? 700 : undefined,
        })
      : "";
    return [
      `<rect x="${centerX - barWidth / 2}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${options.radius}" fill="${options.accent}" opacity="${itemOpacity}"/>`,
      valueText,
      fittedText(item.label, {
        x: centerX,
        y: 95,
        width: Math.max(slotWidth - 1, 1),
        fontSize: labelFontSize,
        fill: options.textColor,
      }),
    ].join("");
  }).join("");

  const baseline = scale.min < 0 || options.showBaseline
    ? `<line x1="${plotLeft}" y1="${baselineY}" x2="${plotRight}" y2="${baselineY}" stroke="${options.textColor}" stroke-width="0.5" opacity="0.35"/>`
    : "";
  return `${baseline}${bars}`;
}

function renderHorizontalBars(
  element: ChartElement,
  items: ChartItem[],
  options: {
    accent: string;
    textColor: string;
    opacity: number;
    radius: number;
    showValues: boolean;
  },
): string {
  const plotLeft = 29;
  const plotRight = 97;
  const plotWidth = plotRight - plotLeft;
  const rowHeight = 94 / items.length;
  const barHeight = Math.max(1.2, Math.min(8, rowHeight * 0.55));
  const fontSize = Math.max(2.1, Math.min(4, rowHeight * 0.34));
  const scale = chartScale(items);
  const valueToX = (value: number) =>
    plotLeft + ((value - scale.min) / scale.range) * plotWidth;
  const baselineX = valueToX(0);

  const rows = items.map((item, index) => {
    const centerY = 3 + rowHeight * index + rowHeight / 2;
    const valueX = valueToX(item.value);
    const barX = Math.min(baselineX, valueX);
    const barWidth = Math.max(0.7, Math.abs(baselineX - valueX));
    const itemOpacity = opacityForItem(index, element.highlightIndex, options.opacity);
    const valueAnchor = item.value >= 0 ? "start" : "end";
    const valueLabelX = item.value >= 0
      ? Math.min(99, barX + barWidth + 1)
      : Math.max(plotLeft - 1, barX - 1);
    return [
      fittedText(item.label, {
        x: 2,
        y: centerY + fontSize * 0.35,
        width: 24,
        fontSize,
        fill: options.textColor,
        anchor: "start",
      }),
      `<rect x="${barX}" y="${centerY - barHeight / 2}" width="${barWidth}" height="${barHeight}" rx="${options.radius}" fill="${options.accent}" opacity="${itemOpacity}"/>`,
      options.showValues
        ? fittedText(formatValue(item.value, element.unit), {
            x: valueLabelX,
            y: centerY + fontSize * 0.35,
            width: 16,
            fontSize: Math.max(2.1, fontSize * 0.9),
            fill: index === element.highlightIndex ? options.accent : options.textColor,
            anchor: valueAnchor,
            weight: index === element.highlightIndex ? 700 : undefined,
          })
        : "",
    ].join("");
  }).join("");

  const baseline = scale.min < 0
    ? `<line x1="${baselineX}" y1="3" x2="${baselineX}" y2="98" stroke="${options.textColor}" stroke-width="0.5" opacity="0.35"/>`
    : "";
  return `${baseline}${rows}`;
}

function renderTimeline(
  element: ChartElement,
  items: ChartItem[],
  options: {
    accent: string;
    textColor: string;
    opacity: number;
    showValues: boolean;
  },
): string {
  const stepWidth = 90 / items.length;
  const fontSize = Math.max(2.1, Math.min(4, stepWidth * 0.36));
  const nodes = items.map((item, index) => {
    const centerX = 5 + stepWidth * index + stepWidth / 2;
    const itemOpacity = opacityForItem(index, element.highlightIndex, options.opacity);
    const highlighted = index === element.highlightIndex;
    return [
      `<circle cx="${centerX}" cy="50" r="${highlighted ? 5 : 4}" fill="${options.accent}" opacity="${itemOpacity}"/>`,
      fittedText(item.label, {
        x: centerX,
        y: 36,
        width: Math.max(1, stepWidth - 2),
        fontSize,
        fill: options.textColor,
        weight: highlighted ? 700 : undefined,
      }),
      options.showValues
        ? fittedText(formatValue(item.value, element.unit), {
            x: centerX,
            y: 68,
            width: Math.max(1, stepWidth - 2),
            fontSize: Math.max(2.1, fontSize * 0.9),
            fill: options.accent,
            weight: highlighted ? 700 : undefined,
          })
        : "",
    ].join("");
  }).join("");
  return `<line x1="5" y1="50" x2="95" y2="50" stroke="${options.accent}" stroke-width="1.5" opacity="0.45"/>${nodes}`;
}

export function chartDataToSvgString(
  element: ChartElement,
  defaultAccent = "#0ea5e9",
  defaultStyle: ChartStyle = "minimal",
  textColor = "#475569",
): string {
  const accent = safeHexColor(element.accentColor, safeHexColor(defaultAccent, "#0ea5e9"));
  const safeTextColor = safeHexColor(textColor, "#475569");
  const chartStyle = element.chartStyle ?? defaultStyle;
  const items = normalizeChartData(element);
  const radius = chartStyle === "editorial" ? 3 : chartStyle === "minimal" ? 0 : 1.5;
  const opacity = chartStyle === "dashboard" ? 0.92 : chartStyle === "editorial" ? 0.72 : 0.84;
  const showValues = chartStyle !== "minimal";
  const fontFamily = chartStyle === "editorial" ? "Georgia,serif" : "Arial,sans-serif";
  const svg = (content: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="font-family:${fontFamily}">${content}</svg>`;

  if (items.length === 0) return svg(renderEmptyChart(safeTextColor));

  if (element.chartType === "h-bar") {
    return svg(renderHorizontalBars(element, items, {
      accent,
      textColor: safeTextColor,
      opacity,
      radius,
      showValues,
    }));
  }

  if (element.chartType === "timeline") {
    return svg(renderTimeline(element, items, {
      accent,
      textColor: safeTextColor,
      opacity,
      showValues,
    }));
  }

  return svg(renderVerticalBars(element, items, {
    accent,
    textColor: safeTextColor,
    opacity,
    radius,
    showValues,
    tower: element.chartType === "kpi-tower",
    showBaseline: chartStyle === "report",
  }));
}

export function chartSvgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}
