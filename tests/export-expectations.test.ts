// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Presentation } from "../src/shared/presentation";
import { DEFAULT_DESIGN_SYSTEM } from "../src/design-system";
import {
  confirmSvgExportExpectation,
  presentationUsesSvgPages,
} from "../src/renderer/src/app/presentation/exportExpectations";

const SVG_SHA = "a".repeat(64);

function svgPresentation(): Presentation {
  return {
    id: "deck-1",
    title: "SVG deck",
    revision: 1,
    designSystem: DEFAULT_DESIGN_SYSTEM,
    slides: [
      {
        id: "svg-1",
        title: "SVG",
        elements: [],
        visualSource: {
          kind: "svg",
          width: 1280,
          height: 720,
          markup: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"720\"></svg>",
          sha256: SVG_SHA,
          sourcePath: "slides/svg/P01.svg",
          resources: [],
        },
      },
    ],
  };
}

describe("exportExpectations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects SVG-native pages", () => {
    expect(presentationUsesSvgPages(svgPresentation())).toBe(true);
  });

  it("asks before exporting SVG decks", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(confirmSvgExportExpectation(svgPresentation())).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
