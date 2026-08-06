import { describe, expect, it } from "vitest";

import {
  ARGUMENT_MODES,
  brandProfileV2Schema,
  DEFAULT_BRAND_PROFILE,
  DEFAULT_DESIGN_SYSTEM,
  DESIGN_PRESETS,
  designSystemV2Schema,
  getDesignPreset,
  queryDesignPresets,
  READING_MODES,
  resolveBrandProfileDesignSystem,
  resolveSlideStyle,
  searchVisualStyles,
  selectDesignPreset,
  VISUAL_STYLE_CATALOG,
  VISUAL_STYLES,
} from "../src/design-system";

describe("DesignSystem v2", () => {
  it("accepts only the strict version-2 source contract", () => {
    expect(designSystemV2Schema.parse(DEFAULT_DESIGN_SYSTEM)).toEqual(DEFAULT_DESIGN_SYSTEM);
    expect(() =>
      designSystemV2Schema.parse({
        version: 1,
        tokens: {},
      }),
    ).toThrow();
    expect(() =>
      designSystemV2Schema.parse({
        ...DEFAULT_DESIGN_SYSTEM,
        tokens: {},
      }),
    ).toThrow();
  });

  it("contains all argument, reading, and visual catalog axes", () => {
    expect(ARGUMENT_MODES).toEqual([
      "pyramid",
      "narrative",
      "instructional",
      "showcase",
      "briefing",
    ]);
    expect(READING_MODES).toEqual(["text", "balanced", "presentation"]);
    expect(VISUAL_STYLES).toHaveLength(18);
    expect(VISUAL_STYLE_CATALOG.map((item) => item.id)).toEqual([...VISUAL_STYLES]);
  });

  it("keeps every style executable and free of fixed palette values", () => {
    for (const style of VISUAL_STYLE_CATALOG) {
      expect(style.shape).toMatchObject({
        radius: expect.any(Number),
        strokeWidth: expect.any(Number),
      });
      expect(style.elevation.kind).toBeTruthy();
      expect(style.whitespace.margin).toBeGreaterThan(0);
      expect(style.typography.headingFamily).toBeTruthy();
      expect(style.typography.bodyFamily).toBeTruthy();
      expect(style.background.style).toBeTruthy();
      expect(style.texture.kind).toBeTruthy();
      expect(style.imageRendering).toBeTruthy();
      expect(["core", "supportive", "sparse"]).toContain(style.illustrationPropensity);
      expect(style.grammarPreferences.preferredVariants.length).toBeGreaterThan(0);
      expect(JSON.stringify(style)).not.toMatch(/#[0-9a-f]{6}/i);
    }
  });

  it("ships at least one preset per visual style and exposes query helpers", () => {
    expect(DESIGN_PRESETS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(DESIGN_PRESETS.map((item) => item.system.visualStyle))).toEqual(
      new Set(VISUAL_STYLES),
    );
    expect(getDesignPreset("dark-tech")?.system.visualStyle).toBe("dark-tech");
    expect(queryDesignPresets({ readingMode: "text" }).length).toBeGreaterThan(0);
    expect(searchVisualStyles("工程")[0]?.id).toBe("blueprint");
    expect(selectDesignPreset({ query: "像素" }).visualStyle).toBe("pixel-art");
  });

  it("resolves renderer-ready visual facts, including heading/body typography", () => {
    const style = resolveSlideStyle(
      selectDesignPreset({
        visualStyle: "glassmorphism",
        readingMode: "presentation",
      }),
      {},
    );
    expect(style.visualStyle).toBe("glassmorphism");
    expect(style.mode).toBe("dark");
    expect(style.colors).toMatchObject({
      background: expect.stringMatching(/^#/),
      secondaryBg: expect.stringMatching(/^#/),
      primary: expect.stringMatching(/^#/),
      accent: expect.stringMatching(/^#/),
      secondaryAccent: expect.stringMatching(/^#/),
      bodyText: expect.stringMatching(/^#/),
      surface: expect.stringMatching(/^#/),
      grid: expect.stringMatching(/^#/),
      scrim: expect.stringMatching(/^#/),
    });
    expect(style.headingTypography.fontSize).toBeGreaterThan(style.bodyTypography.fontSize);
    expect(style.shape.radius).toBe(18);
    expect(style.shape.stroke.width).toBe(1);
    expect(style.shape.shadow).toBeTruthy();
    expect(style.spacing.margin).toBeGreaterThan(0);
    expect(style.background.gradient?.type).toBe("radial");
    expect(style.image.rendering).toBe("glassmorphism");
    expect(style.chart.style).toBe("dashboard");
    expect(style.density).toBe("calm");
    expect(style.motif).toBe("arc");
  });

  it("lets reading mode materially change density, type, and whitespace", () => {
    const source = selectDesignPreset({ visualStyle: "editorial" });
    const text = resolveSlideStyle({ ...source, readingMode: "text" }, {});
    const presentation = resolveSlideStyle({ ...source, readingMode: "presentation" }, {});
    expect(text.density).toBe("dense");
    expect(presentation.density).toBe("calm");
    expect(text.bodyTypography.fontSize).toBeLessThan(presentation.bodyTypography.fontSize);
    expect(text.spacing.margin).toBeLessThan(presentation.spacing.margin);
  });

  it("keeps color scheme independent and applies user colors last", () => {
    const base = selectDesignPreset({
      visualStyle: "swiss-minimal",
      colorScheme: "business-blue",
    });
    const warm = resolveSlideStyle({ ...base, colorScheme: "warm-paper" }, {});
    const custom = resolveSlideStyle(
      {
        ...base,
        colors: {
          background: "#112233",
          secondaryBg: "#223344",
          primary: "#fefefe",
          accent: "#ff3366",
          secondaryAccent: "#ff99aa",
          bodyText: "#eeeeee",
          surface: "#1a2b3c",
          grid: "#445566",
          scrim: "#000000",
        },
      },
      {},
    );
    expect({
      language: warm.shape.language,
      radius: warm.shape.radius,
      strokeWidth: warm.shape.stroke.width,
      elevation: warm.shape.elevation,
    }).toEqual({
      language: resolveSlideStyle(base, {}).shape.language,
      radius: resolveSlideStyle(base, {}).shape.radius,
      strokeWidth: resolveSlideStyle(base, {}).shape.stroke.width,
      elevation: resolveSlideStyle(base, {}).shape.elevation,
    });
    expect(warm.colors.accent).not.toBe(resolveSlideStyle(base, {}).colors.accent);
    expect(custom.colors).toMatchObject({
      background: "#112233",
      secondaryBg: "#223344",
      primary: "#fefefe",
      accent: "#ff3366",
      secondaryAccent: "#ff99aa",
      bodyText: "#eeeeee",
      surface: "#1a2b3c",
      grid: "#445566",
      scrim: "#000000",
      bg: "#112233",
      title: "#fefefe",
      body: "#eeeeee",
    });
  });

  it("resolves brand profiles through the v2 axes", () => {
    expect(brandProfileV2Schema.parse(DEFAULT_BRAND_PROFILE)).toEqual(DEFAULT_BRAND_PROFILE);
    const system = resolveBrandProfileDesignSystem({
      ...DEFAULT_BRAND_PROFILE,
      persona: "product-technology",
      designOverrides: { readingMode: "presentation" },
    });
    expect(system).toMatchObject({
      version: 2,
      visualStyle: "dark-tech",
      readingMode: "presentation",
    });
  });
});
