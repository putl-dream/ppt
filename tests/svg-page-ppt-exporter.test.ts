import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStarterPresentation } from "../src/shared/presentation";

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
      elements: [],
      visualSource: {
        kind: "svg",
        markup,
        width: 1280,
        height: 720,
        sha256: "b".repeat(64),
        sourcePath: "slides/svg/slide-1.svg",
        resources: [],
      },
    };

    await exportToPptx(
      presentation,
      { logoUrl: "data:image/png;base64,ignored" },
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

  it("rejects a mixed SVG and legacy-element slide", async () => {
    const presentation = createStarterPresentation();
    presentation.slides[0] = {
      id: "mixed-slide",
      title: "Mixed visual truth",
      elements: [{
        id: "legacy-text",
        type: "text",
        x: 20,
        y: 20,
        width: 200,
        height: 80,
        text: "Legacy element",
        fontSize: 24,
      }],
      visualSource: {
        kind: "svg",
        markup:
          '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"></svg>',
        width: 1280,
        height: 720,
        sha256: "b".repeat(64),
        sourcePath: "slides/svg/mixed.svg",
        resources: [],
      },
    };

    await expect(exportToPptx(
      presentation,
      {},
      "/tmp/mixed-svg-page.pptx",
    )).rejects.toThrow("contains legacy canvas elements");
  });
});
