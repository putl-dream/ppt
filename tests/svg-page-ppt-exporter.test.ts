import { beforeEach, describe, expect, it, vi } from "vitest";
import { type SlideNarrative } from "../src/shared/presentation";
import { createStarterPresentation, createSvgVisualSource } from "../src/shared/presentation-fixtures";

const pptxMocks = vi.hoisted(() => {
  const slide = {
    background: undefined as unknown,
    addImage: vi.fn(),
    addNotes: vi.fn(),
    addText: vi.fn(),
    addShape: vi.fn(),
    addChart: vi.fn(),
    addTable: vi.fn(),
  };
  const instance = {
    layout: "",
    defineLayout: vi.fn(),
    addSlide: vi.fn(() => slide),
    writeFile: vi.fn(async () => undefined),
  };
  return { instance, slide };
});

vi.mock("pptxgenjs", () => ({
  default: function MockPptxGen() {
    return pptxMocks.instance;
  },
}));

import { exportToPptx } from "../src/main/ppt-exporter";

const NARRATIVE: SlideNarrative = {
  role: "cover",
  coreMessage: "SVG page export",
  audienceMove: "Review",
  rhythm: "anchor",
  layoutIntent: "One full-page SVG.",
};

describe("SVG page PPTX export", () => {
  beforeEach(() => {
    pptxMocks.instance.layout = "";
    pptxMocks.instance.defineLayout.mockClear();
    pptxMocks.instance.addSlide.mockClear();
    pptxMocks.instance.writeFile.mockClear();
    pptxMocks.slide.background = undefined;
    [
      pptxMocks.slide.addImage,
      pptxMocks.slide.addNotes,
      pptxMocks.slide.addText,
      pptxMocks.slide.addShape,
      pptxMocks.slide.addChart,
      pptxMocks.slide.addTable,
    ].forEach((mock) => mock.mockClear());
  });

  it("exports one full-slide SVG image and skips all legacy chrome", async () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">'
      + '<text x="40" y="80">SVG page</text></svg>';
    const presentation = createStarterPresentation();
    presentation.id = "deck-1";
    presentation.title = "SVG deck";
    presentation.revision = 1;
    presentation.slides[0] = {
      id: "slide-1",
      title: "Legacy chrome must not appear",
      speakerNotes: "Speaker note",
      narrative: NARRATIVE,
      visualSource: createSvgVisualSource({
        markup,
        sourcePath: "slides/svg/slide-1.svg",
        title: "Legacy chrome must not appear",
      }),
    };

    await exportToPptx(
      presentation,
      {},
      "/tmp/svg-page.pptx",
    );

    expect(pptxMocks.instance.defineLayout).toHaveBeenCalledWith({
      name: "AGENT_PPT_WIDE",
      width: 10,
      height: 5.625,
    });
    expect(pptxMocks.instance.layout).toBe("AGENT_PPT_WIDE");
    expect(pptxMocks.slide.background).toEqual({ fill: "FFFFFF" });
    expect(pptxMocks.slide.addImage).toHaveBeenCalledTimes(1);
    expect(pptxMocks.slide.addImage).toHaveBeenCalledWith({
      data: `data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}`,
      x: 0,
      y: 0,
      w: 10,
      h: 5.625,
    });
    expect(pptxMocks.slide.addNotes).toHaveBeenCalledWith("Speaker note");
    expect(pptxMocks.slide.addText).not.toHaveBeenCalled();
    expect(pptxMocks.slide.addShape).not.toHaveBeenCalled();
    expect(pptxMocks.slide.addChart).not.toHaveBeenCalled();
    expect(pptxMocks.slide.addTable).not.toHaveBeenCalled();
    expect(pptxMocks.instance.writeFile).toHaveBeenCalledWith({
      fileName: "/tmp/svg-page.pptx",
    });
  });

  it("rejects a slide without SVG visualSource", async () => {
    const presentation = createStarterPresentation();
    (presentation.slides[0] as { visualSource?: unknown }).visualSource = undefined;

    await expect(exportToPptx(
      presentation,
      {},
      "/tmp/non-svg-page.pptx",
    )).rejects.toThrow("not SVG-native");
  });
});
