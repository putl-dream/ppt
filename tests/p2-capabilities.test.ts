import { describe, expect, it } from "vitest";
import { executeCommand } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";
import {
  resolveSlideBackgroundWithVariant,
  resolveSlideVariant,
  SLIDE_VARIANTS,
} from "../src/shared/slide-variant";
import { layoutRegistry } from "../src/shared/layout-registry";
import "../src/shared/layout-register-builtin";
import { chartDataToSvgString } from "../src/shared/chart-utils";
import { iconToSvgString, isValidIconName } from "../src/shared/icon-registry";
import { exportToHtml } from "../src/shared/html-exporter";

describe("P2 slide variant", () => {
  it("supports light/dark/hero slide variants", () => {
    expect(SLIDE_VARIANTS).toContain("light");
    expect(SLIDE_VARIANTS).toContain("dark");
    expect(SLIDE_VARIANTS).toContain("hero");
  });

  it("resolves light variant to white background", () => {
    const bg = resolveSlideBackgroundWithVariant("ocean", "cyan", { slideVariant: "light" });
    expect(bg.slideBg).toBe("#ffffff");
    expect(bg.exportFill).toBe("#ffffff");
  });

  it("resolves dark variant to dark background", () => {
    const bg = resolveSlideBackgroundWithVariant("nordic", "cyan", { slideVariant: "dark" });
    expect(bg.exportFill).toBe("#0f172a");
  });

  it("infers hero variant from cover layout", () => {
    expect(resolveSlideVariant({ layout: "cover" })).toBe("hero");
    expect(resolveSlideVariant({ layout: "concept" })).toBeUndefined();
  });

  it("update-slide-variant command sets and clears variant", () => {
    let presentation = createStarterPresentation();
    const slideId = presentation.slides[0].id;

    const setResult = executeCommand(presentation, {
      id: crypto.randomUUID(),
      type: "update-slide-variant",
      slideId,
      slideVariant: "dark",
    });
    presentation = setResult.presentation;
    expect(presentation.slides[0].slideVariant).toBe("dark");

    const clearResult = executeCommand(presentation, {
      id: crypto.randomUUID(),
      type: "update-slide-variant",
      slideId,
      slideVariant: undefined,
    });
    presentation = clearResult.presentation;
    expect(presentation.slides[0].slideVariant).toBeUndefined();
  });
});

describe("P2 chart element", () => {
  it("generates SVG for bar chart", () => {
    const svg = chartDataToSvgString({
      id: "1",
      type: "chart",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      chartType: "bar",
      data: { labels: ["A", "B"], values: [50, 80] },
    });
    expect(svg).toContain("<rect");
    expect(svg).toContain("svg");
  });

  it("add-element accepts chart type", () => {
    let presentation = createStarterPresentation();
    const slideId = presentation.slides[0].id;
    const result = executeCommand(presentation, {
      id: crypto.randomUUID(),
      type: "add-element",
      slideId,
      element: {
        id: crypto.randomUUID(),
        type: "chart",
        x: 100,
        y: 200,
        width: 400,
        height: 300,
        chartType: "kpi-tower",
        data: { items: [{ label: "Revenue", value: 76 }] },
        accentColor: "#0ea5e9",
      },
    });
    presentation = result.presentation;
    const chart = presentation.slides[0].elements.find((el) => el.type === "chart");
    expect(chart).toBeDefined();
    if (chart?.type === "chart") {
      expect(chart.chartType).toBe("kpi-tower");
    }
  });
});

describe("P2 table element", () => {
  it("add-element accepts table with rows", () => {
    let presentation = createStarterPresentation();
    const slideId = presentation.slides[0].id;
    const result = executeCommand(presentation, {
      id: crypto.randomUUID(),
      type: "add-element",
      slideId,
      element: {
        id: crypto.randomUUID(),
        type: "table",
        x: 120,
        y: 200,
        width: 800,
        height: 300,
        rows: [
          ["指标", "数值"],
          ["转化率", "76%"],
          ["留存率", "89%"],
        ],
        headerRow: true,
        zebraStripe: true,
      },
    });
    presentation = result.presentation;
    const table = presentation.slides[0].elements.find((el) => el.type === "table");
    expect(table?.type).toBe("table");
    if (table?.type === "table") {
      expect(table.rows.length).toBe(3);
    }
  });
});

describe("P2 icon element", () => {
  it("validates icon names and generates SVG", () => {
    expect(isValidIconName("star")).toBe(true);
    expect(isValidIconName("invalid-icon")).toBe(false);
    const svg = iconToSvgString("star", "#ff0000");
    expect(svg).toContain("path");
    expect(svg).toContain("#ff0000");
  });

  it("add-element accepts icon type", () => {
    let presentation = createStarterPresentation();
    const slideId = presentation.slides[0].id;
    const result = executeCommand(presentation, {
      id: crypto.randomUUID(),
      type: "add-element",
      slideId,
      element: {
        id: crypto.randomUUID(),
        type: "icon",
        x: 100,
        y: 100,
        width: 48,
        height: 48,
        name: "target",
        color: "#10b981",
        strokeWidth: 2,
      },
    });
    presentation = result.presentation;
    const icon = presentation.slides[0].elements.find((el) => el.type === "icon");
    expect(icon?.type).toBe("icon");
  });
});

describe("P2 layout registry", () => {
  it("registers all 11 built-in layouts", () => {
    expect(layoutRegistry.getAll().length).toBe(11);
    expect(layoutRegistry.has("cover")).toBe(true);
    expect(layoutRegistry.has("image-grid")).toBe(true);
    expect(layoutRegistry.get("quote")?.defaultSlideVariant).toBe("light");
  });
});

describe("P2 HTML export", () => {
  it("exports presentation to HTML with slides", () => {
    const presentation = createStarterPresentation();
    const html = exportToHtml(presentation, { theme: "nordic", palette: "cyan" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("slide");
    expect(html).toContain(presentation.title);
  });

  it("includes table element in HTML export", () => {
    let presentation = createStarterPresentation();
    const slideId = presentation.slides[0].id;
    const result = executeCommand(presentation, {
      id: crypto.randomUUID(),
      type: "add-element",
      slideId,
      element: {
        id: crypto.randomUUID(),
        type: "table",
        x: 0,
        y: 0,
        width: 400,
        height: 200,
        rows: [["A", "B"], ["1", "2"]],
        headerRow: true,
        zebraStripe: true,
      },
    });
    const html = exportToHtml(result.presentation);
    expect(html).toContain("<table");
    expect(html).toContain("A");
  });
});
