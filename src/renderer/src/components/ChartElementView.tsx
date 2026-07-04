import type { ChartElement } from "@shared/presentation";

interface ChartElementViewProps {
  element: ChartElement;
  defaultAccent?: string;
}

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

export function ChartElementView({ element, defaultAccent = "#0ea5e9" }: ChartElementViewProps) {
  const accent = element.accentColor ?? defaultAccent;
  const items = normalizeChartData(element);
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  if (element.chartType === "kpi-tower") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 16,
          padding: "8px 12px",
          boxSizing: "border-box",
        }}
      >
        {items.slice(0, 4).map((item, idx) => {
          const barH = Math.max(20, (item.value / maxValue) * 100);
          return (
            <div
              key={idx}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                height: "100%",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: accent, marginBottom: 4 }}>
                {item.value}
              </div>
              <div
                style={{
                  width: "100%",
                  height: `${barH}%`,
                  backgroundColor: accent,
                  borderRadius: "4px 4px 0 0",
                  opacity: 0.85 - idx * 0.1,
                }}
              />
              <div style={{ fontSize: 11, marginTop: 4, textAlign: "center", opacity: 0.8 }}>
                {item.label}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (element.chartType === "h-bar") {
    const rowH = 100 / items.length;
    return (
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {items.map((item, idx) => {
          const barW = (item.value / maxValue) * 70;
          const y = idx * rowH + rowH * 0.15;
          const h = rowH * 0.7;
          return (
            <g key={idx}>
              <text x={2} y={y + h * 0.65} fontSize={4} fill="currentColor" opacity={0.8}>
                {item.label.slice(0, 12)}
              </text>
              <rect x={28} y={y} width={barW} height={h} fill={accent} rx={1} />
              <text x={28 + barW + 2} y={y + h * 0.65} fontSize={3.5} fill={accent}>
                {item.value}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  if (element.chartType === "timeline") {
    const stepW = 100 / Math.max(items.length, 1);
    return (
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <line x1={5} y1={50} x2={95} y2={50} stroke={accent} strokeWidth={1.5} opacity={0.4} />
        {items.map((item, idx) => {
          const cx = 5 + stepW * idx + stepW / 2;
          return (
            <g key={idx}>
              <circle cx={cx} cy={50} r={4} fill={accent} />
              <text
                x={cx}
                y={38}
                textAnchor="middle"
                fontSize={4}
                fill="currentColor"
                fontWeight={600}
              >
                {item.label.slice(0, 10)}
              </text>
              <text x={cx} y={68} textAnchor="middle" fontSize={3.5} fill={accent}>
                {item.value}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  // bar (default)
  const barW = 80 / items.length;
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      {items.map((item, idx) => {
        const barH = (item.value / maxValue) * 75;
        const x = 10 + idx * barW;
        return (
          <g key={idx}>
            <rect
              x={x}
              y={85 - barH}
              width={barW * 0.7}
              height={barH}
              fill={accent}
              rx={1}
            />
            <text x={x + barW * 0.35} y={92} textAnchor="middle" fontSize={3.5} fill="currentColor">
              {item.label.slice(0, 8)}
            </text>
            <text x={x + barW * 0.35} y={85 - barH - 2} textAnchor="middle" fontSize={3} fill={accent}>
              {item.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
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

  const bars = items
    .map((item, idx) => {
      const barH = (item.value / maxValue) * 75;
      const x = 10 + idx * (80 / items.length);
      return `<rect x="${x}" y="${85 - barH}" width="8" height="${barH}" fill="${accent}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bars}</svg>`;
}
