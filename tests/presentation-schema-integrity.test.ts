import { describe, expect, it } from "vitest";

import { chartDataToSvgString } from "../src/shared/chart-utils";
import { exportPresentationOptionsSchema } from "../src/shared/ipc";
import {
  chartElementSchema,
  imageElementSchema,
  tableElementSchema,
  textElementSchema,
} from "../src/shared/presentation";

describe("presentation element integrity", () => {
  it("accepts only supported raster data URLs for export logos", () => {
    expect(exportPresentationOptionsSchema.safeParse({
      logoUrl: "data:image/png;base64,iVBORw0KGgo=",
    }).success).toBe(true);
    expect(exportPresentationOptionsSchema.safeParse({ logoUrl: "C:\\private\\logo.png" }).success)
      .toBe(false);
    expect(exportPresentationOptionsSchema.safeParse({
      logoUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    }).success).toBe(false);
    expect(exportPresentationOptionsSchema.safeParse({
      logoUrl: "data:image/png;base64,PHN2Zz48L3N2Zz4=",
    }).success).toBe(false);
    expect(exportPresentationOptionsSchema.safeParse({ unexpected: true }).success).toBe(false);
    expect(exportPresentationOptionsSchema.safeParse({ allowUnverifiedAssets: true }).success)
      .toBe(true);
  });

  it("rejects empty, mismatched, or ambiguous chart data", () => {
    const base = {
      id: "chart",
      type: "chart" as const,
      x: 100,
      y: 180,
      width: 500,
      height: 280,
      chartType: "bar" as const,
    };

    expect(chartElementSchema.safeParse({ ...base, data: {} }).success).toBe(false);
    expect(chartElementSchema.safeParse({
      ...base,
      data: { labels: ["A", "B"], values: [1] },
    }).success).toBe(false);
    expect(chartElementSchema.safeParse({
      ...base,
      data: {
        items: [{ label: "A", value: 1 }],
        labels: ["A"],
        values: [1],
      },
    }).success).toBe(false);
  });

  it("renders every KPI item without fabricated defaults or label slicing", () => {
    const svg = chartDataToSvgString({
      id: "chart",
      type: "chart",
      x: 100,
      y: 180,
      width: 500,
      height: 280,
      chartType: "kpi-tower",
      chartStyle: "dashboard",
      unit: "%",
      highlightIndex: 4,
      data: {
        items: [
          { label: "First metric", value: 10 },
          { label: "Second metric", value: 20 },
          { label: "Third metric", value: 30 },
          { label: "Fourth metric", value: 40 },
          { label: "Fifth metric with full label", value: 50 },
        ],
      },
    });

    expect(svg).toContain("First metric");
    expect(svg).toContain("Fifth metric with full label");
    expect(svg).toContain("50%");
    expect(svg).not.toContain("Item 5");
  });

  it("does not fabricate chart values when legacy invalid data reaches the renderer", () => {
    const svg = chartDataToSvgString({
      id: "chart",
      type: "chart",
      x: 100,
      y: 180,
      width: 500,
      height: 280,
      chartType: "bar",
      data: {},
    });

    expect(svg).toContain("No chart data");
    expect(svg).not.toContain(">50<");
    expect(svg).not.toContain(">75<");
  });

  it("rejects unsafe colors, image schemes, and ragged tables", () => {
    expect(textElementSchema.safeParse({
      id: "text",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      text: "Unsafe",
      fontSize: 20,
      color: "red;position:fixed",
    }).success).toBe(false);

    expect(imageElementSchema.safeParse({
      id: "image",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      url: "javascript:alert(1)",
    }).success).toBe(false);

    expect(tableElementSchema.safeParse({
      id: "table",
      type: "table",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      rows: [["A", "B"], ["1"]],
    }).success).toBe(false);
  });
});
