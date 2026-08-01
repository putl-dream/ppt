// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSvgTestSlide } from "../src/shared/presentation";
import { DEFAULT_DESIGN_SYSTEM } from "../src/design-system";
import {
  confirmSvgExportExpectation,
  presentationUsesSvgPages,
} from "../src/renderer/src/app/presentation/exportExpectations";

function svgPresentation() {
  return {
    id: "deck-1",
    title: "SVG deck",
    revision: 1,
    designSystem: DEFAULT_DESIGN_SYSTEM,
    slides: [createSvgTestSlide({ id: "svg-1", title: "SVG" })],
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
