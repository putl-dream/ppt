import { describe, expect, it } from "vitest";
import { executeCommand } from "../src/shared/commands";
import type { DesignTokensV1 } from "../src/shared/design-tokens";
import type { Presentation, Slide } from "../src/shared/presentation";
import { resolveSlideDesignSystem } from "../src/shared/resolved-design-system";
import { exportSlideThumbnailHtml } from "../src/shared/slide-html-render";

const tokens: DesignTokensV1 = {
  version: 1,
  palette: "warm-paper",
  fontMood: "editorial",
  shapeLanguage: "editorial",
  backgroundStyle: "grid",
  motif: "margin-note",
  density: "calm",
  imageTreatment: "framed",
  chartStyle: "report",
};

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: "slide-1",
    title: "Design contract",
    layout: "concept",
    elements: [],
    ...overrides,
  };
}

describe("resolved design system", () => {
  it("resolves token palette, font, treatments and structured grid once", () => {
    const system = resolveSlideDesignSystem(
      { theme: "ocean", palette: "cyan", designTokens: tokens },
      makeSlide(),
    );

    expect(system.hasExplicitDesignTokens).toBe(true);
    expect(system.colors.accent).toBe("#b45309");
    expect(system.fontFamily).toBe("serif");
    expect(system.imageTreatment).toBe("framed");
    expect(system.chartStyle).toBe("report");
    expect(system.background.pattern).toEqual({
      type: "grid",
      color: system.colors.cardStroke,
      size: 32,
    });
    expect(system.background.slideBg).toContain("32px 32px");
  });

  it("adapts complete foreground and surface colors for slide light/dark variants", () => {
    const light = resolveSlideDesignSystem(
      { theme: "ocean", palette: "cyan" },
      makeSlide({ slideVariant: "light" }),
    );
    const dark = resolveSlideDesignSystem(
      { theme: "nordic", palette: "cyan", designTokens: tokens },
      makeSlide({ slideVariant: "dark" }),
    );

    expect(light.background.exportFill).toBe("#ffffff");
    expect(light.colors.title).toBe("#0f172a");
    expect(dark.background.exportFill).toBe("#07111f");
    expect(dark.colors.title).toBe("#eff6ff");
    expect(dark.colors.accent).toBe("#b45309");
  });

  it("uses the same resolved values in thumbnail HTML", () => {
    const slide = makeSlide({
      designTokens: tokens,
      elements: [
        {
          id: "image-1",
          type: "image",
          x: 100,
          y: 100,
          width: 400,
          height: 240,
          url: "data:image/png;base64,AA==",
          borderRadius: 0,
        },
        {
          id: "chart-1",
          type: "chart",
          x: 560,
          y: 100,
          width: 400,
          height: 240,
          chartType: "bar",
          data: { labels: ["A"], values: [42] },
        },
      ],
    });
    const html = exportSlideThumbnailHtml(slide, { theme: "ocean", palette: "cyan" });

    expect(html).toContain("#b45309");
    expect(html).toContain("padding:8px");
    expect(html).toContain("32px 32px");
    expect(html).toContain(">42</text>");
  });

  it("fits long chrome titles and keeps masked treatment consistent with PPTX rounding", () => {
    const slide = makeSlide({
      title: "A deliberately long presentation title that must stay on one chrome line",
      designTokens: { ...tokens, imageTreatment: "masked" },
      elements: [{
        id: "masked-image",
        type: "image",
        x: 100,
        y: 180,
        width: 500,
        height: 220,
        url: "data:image/png;base64,AA==",
        borderRadius: 0,
      }],
    });
    const html = exportSlideThumbnailHtml(slide, { theme: "nordic", palette: "cyan" });

    expect(html).toContain("font-size:24px;white-space:nowrap");
    expect(html).toContain("border-radius:9999px");
  });

  it("recompiles layout colors when a slide variant changes and restores exactly on undo", () => {
    const presentation: Presentation = {
      id: "deck-1",
      title: "Variant",
      revision: 0,
      theme: "nordic",
      palette: "cyan",
      designTokens: tokens,
      slides: [makeSlide({
        elements: [
          {
            id: "body-1",
            type: "text",
            x: 120,
            y: 200,
            width: 900,
            height: 80,
            text: "Body",
            fontSize: 28,
          },
          {
            id: "body-2",
            type: "text",
            x: 120,
            y: 300,
            width: 900,
            height: 80,
            text: "Supporting body",
            fontSize: 24,
          },
        ],
      })],
    };
    const before = structuredClone(presentation.slides[0]);
    const result = executeCommand(presentation, {
      id: "command-1",
      type: "update-slide-variant",
      slideId: "slide-1",
      slideVariant: "dark",
    });

    expect(result.presentation.slides[0].slideVariant).toBe("dark");
    expect(result.presentation.slides[0].elements.some(
      (element) => element.type === "text" && element.color === "#bad3ee",
    )).toBe(true);
    expect(result.executed.inverse).toMatchObject({ type: "restore-slide", slide: before });
  });
});
