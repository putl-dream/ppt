import type { ChartElement } from "./presentation";
import type { ChartStyle } from "./design-tokens";
import { utf8ToBase64 } from "./base64";

function normalizeChartData(element: ChartElement): { label: string; value: number }[] {
  const { data } = element;
  if (data.items?.length) return data.items;
  const labels = data.labels ?? [];
  const values = data.values ?? [];
  const len = Math.max(labels.length, values.length);
  const items: { label: string; value: number }[] = [];
  for (let i = 0; i < len; i += 1) {
    items.push({ label: labels[i] ?? `Item ${i + 1}`, value: values[i] ?? 0 });
  }
  return items.length ? items : [{ label: "A", value: 50 }, { label: "B", value: 75 }];
}

export function chartDataToSvgString(
  element: ChartElement,
  defaultAccent = "#0ea5e9",
  defaultStyle: ChartStyle = "minimal",
  textColor = "#475569",
): string {
  const accent = element.accentColor ?? defaultAccent;
  const chartStyle = element.chartStyle ?? defaultStyle;
  const items = normalizeChartData(element);
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const escapeXml = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
  const radius = chartStyle === "editorial" ? 3 : chartStyle === "minimal" ? 0 : 1.5;
  const opacity = chartStyle === "dashboard" ? 0.92 : chartStyle === "editorial" ? 0.72 : 0.84;
  const showValues = chartStyle !== "minimal";
  const fontFamily = chartStyle === "editorial" ? "Georgia,serif" : "Arial,sans-serif";
  const svg = (content: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="font-family:${fontFamily};color:${textColor}">${content}</svg>`;

  if (element.chartType === "kpi-tower") {
    const width = 76 / Math.max(items.length, 1);
    const towers = items.slice(0, 4).map((item, idx) => {
      const barH = Math.max(12, (item.value / maxValue) * 64);
      const x = 12 + idx * width;
      return `${showValues ? `<text x="${x + width * 0.34}" y="${79 - barH}" text-anchor="middle" font-size="4" font-weight="700" fill="${accent}">${item.value}</text>` : ""}<rect x="${x}" y="${82 - barH}" width="${width * 0.68}" height="${barH}" rx="${radius}" fill="${accent}" opacity="${Math.max(0.5, opacity - idx * 0.08)}"/><text x="${x + width * 0.34}" y="91" text-anchor="middle" font-size="3.5" fill="${textColor}">${escapeXml(item.label.slice(0, 9))}</text>`;
    }).join("");
    return svg(towers);
  }

  if (element.chartType === "h-bar") {
    const rows = items
      .map((item, idx) => {
        const barW = (item.value / maxValue) * 70;
        const y = idx * (100 / items.length) + 5;
        const valueAtEdge = barW > 64;
        const valueX = valueAtEdge ? 97 : 30 + barW;
        return `<text x="2" y="${y + 8}" font-size="4" fill="${textColor}">${escapeXml(item.label.slice(0, 12))}</text><rect x="28" y="${y}" width="${barW}" height="8" rx="${radius}" fill="${accent}" opacity="${opacity}"/>${showValues ? `<text x="${valueX}" y="${y + 7}" text-anchor="${valueAtEdge ? "end" : "start"}" font-size="3.5" fill="${valueAtEdge ? textColor : accent}">${item.value}</text>` : ""}`;
      })
      .join("");
    return svg(rows);
  }

  if (element.chartType === "timeline") {
    const stepW = 100 / Math.max(items.length, 1);
    const nodes = items
      .map((item, idx) => {
        const cx = 5 + stepW * idx + stepW / 2;
        return `<circle cx="${cx}" cy="50" r="4" fill="${accent}"/><text x="${cx}" y="38" text-anchor="middle" font-size="4" fill="${textColor}">${escapeXml(item.label.slice(0, 10))}</text>${showValues ? `<text x="${cx}" y="68" text-anchor="middle" font-size="3.5" fill="${accent}">${item.value}</text>` : ""}`;
      })
      .join("");
    return svg(`<line x1="5" y1="50" x2="95" y2="50" stroke="${accent}" stroke-width="1.5" opacity="0.45"/>${nodes}`);
  }

  const bars = items
    .map((item, idx) => {
      const barH = (item.value / maxValue) * 75;
      const x = 10 + idx * (80 / items.length);
      return `<rect x="${x}" y="${85 - barH}" width="8" height="${barH}" rx="${radius}" fill="${accent}" opacity="${opacity}"/>${showValues ? `<text x="${x + 4}" y="${82 - barH}" text-anchor="middle" font-size="3.5" fill="${accent}">${item.value}</text>` : ""}<text x="${x + 4}" y="92" text-anchor="middle" font-size="3.2" fill="${textColor}">${escapeXml(item.label.slice(0, 8))}</text>`;
    })
    .join("");
  const baseline = chartStyle === "report"
    ? `<line x1="6" y1="85" x2="96" y2="85" stroke="${textColor}" stroke-width="0.5" opacity="0.35"/>`
    : "";
  return svg(`${baseline}${bars}`);
}

export function chartSvgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}
