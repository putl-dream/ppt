import type { ChartElement } from "./presentation";
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
): string {
  const accent = element.accentColor ?? defaultAccent;
  const items = normalizeChartData(element);
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  if (element.chartType === "h-bar") {
    const rows = items
      .map((item, idx) => {
        const barW = (item.value / maxValue) * 70;
        const y = idx * (100 / items.length) + 5;
        return `<text x="2" y="${y + 8}" font-size="4">${item.label.slice(0, 12)}</text><rect x="28" y="${y}" width="${barW}" height="8" fill="${accent}"/>`;
      })
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${rows}</svg>`;
  }

  if (element.chartType === "timeline") {
    const stepW = 100 / Math.max(items.length, 1);
    const nodes = items
      .map((item, idx) => {
        const cx = 5 + stepW * idx + stepW / 2;
        return `<circle cx="${cx}" cy="50" r="4" fill="${accent}"/><text x="${cx}" y="38" text-anchor="middle" font-size="4">${item.label.slice(0, 10)}</text>`;
      })
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><line x1="5" y1="50" x2="95" y2="50" stroke="${accent}" stroke-width="1.5"/>${nodes}</svg>`;
  }

  const bars = items
    .map((item, idx) => {
      const barH = (item.value / maxValue) * 75;
      const x = 10 + idx * (80 / items.length);
      return `<rect x="${x}" y="${85 - barH}" width="8" height="${barH}" fill="${accent}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bars}</svg>`;
}

export function chartSvgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}
