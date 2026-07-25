import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PresentationCommand } from "../src/shared/commands";
import type {
  Presentation,
  Slide,
  SlideNarrative,
} from "../src/shared/presentation";
import { slideNeedsLayoutChoice } from "../src/shared/presentation-draft";
import { LayoutValidator } from "../src/main/deck/validators/layout-validator";
import {
  applyCommandsToDraft,
  collectAffectedSlideIds,
} from "../src/main/agent/runtime/presentation/layout-command-utils";
import { previewSlideTool } from "../src/main/agent/tools/deferred/preview-slide";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";
import {
  TEST_DESIGN_SYSTEM,
  testDesignSystem,
} from "./design-engine-test-utils";

const SVG_MARKUP = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
  '<rect width="1280" height="720" fill="#101828"/>',
  '<text x="96" y="144" font-size="56" fill="#ffffff">SVG-native page</text>',
  "</svg>",
].join("");

const NARRATIVE: SlideNarrative = {
  role: "opening",
  coreMessage: "The complete-page SVG is the visual source of truth.",
  audienceMove: "Recognize the new authoring contract.",
  rhythm: "anchor",
  layoutIntent: "Use one strong headline on a dark field.",
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function svgSlide(
  id = "svg-slide",
  overrides: Partial<Slide> = {},
): Slide {
  return {
    id,
    title: "SVG-native",
    layout: "concept",
    elements: [],
    visualSource: {
      kind: "svg",
      markup: SVG_MARKUP,
      width: 1280,
      height: 720,
      sha256: sha256(SVG_MARKUP),
      sourcePath: `slides/svg/${id}.svg`,
      resources: [],
    },
    narrative: NARRATIVE,
    ...overrides,
  };
}

function presentation(slides: Slide[]): Presentation {
  return {
    id: "svg-deck",
    title: "SVG-native integration",
    revision: 1,
    designSystem: TEST_DESIGN_SYSTEM,
    slides,
  };
}

function toolContext(deck: Presentation): ToolContext {
  return {
    presentation: deck,
    selectedElementIds: [],
    discoverySession: { discoveredToolNames: new Set() },
    registry: {} as ToolContext["registry"],
    messageHistory: [],
  };
}

describe("SVG-native integration", () => {
  it("LayoutValidator accepts a valid SVG+narrative without legacy empty-element issues and rejects hash tampering", () => {
    const validator = new LayoutValidator();
    const slide = svgSlide();

    const validIssues = validator.validate(presentation([slide]));
    expect(validIssues).toEqual([]);
    expect(
      validIssues.some((issue) => issue.message.includes("no canvas elements")),
    ).toBe(false);

    const tampered = svgSlide("tampered", {
      visualSource: {
        ...slide.visualSource!,
        markup: SVG_MARKUP.replace("SVG-native page", "Tampered page"),
      },
    });
    const tamperedIssues = validator.validate(presentation([tampered]));
    expect(tamperedIssues).toHaveLength(1);
    expect(tamperedIssues[0]).toMatchObject({
      slideId: "tampered",
      category: "layout",
      severity: "error",
    });
    expect(tamperedIssues[0]?.message).toContain(
      "no longer matches its source hash",
    );
  });

  it("slideNeedsLayoutChoice treats a complete SVG page as already designed", () => {
    expect(slideNeedsLayoutChoice(svgSlide())).toBe(false);
  });

  it("collectAffectedSlideIds excludes a removed legacy page after a deck design change", () => {
    const oldSlide: Slide = {
      id: "old-slide",
      title: "Legacy page",
      layout: "concept",
      elements: [{
        id: "old-copy",
        type: "text",
        x: 120,
        y: 160,
        width: 600,
        height: 80,
        text: "Old content",
        fontSize: 32,
      }],
    };
    const newSlide = svgSlide("new-svg-slide");
    const commands: PresentationCommand[] = [
      {
        id: "remove-old",
        type: "remove-slide",
        slideId: oldSlide.id,
      },
      {
        id: "set-design",
        type: "set-design-system",
        designSystem: testDesignSystem({ visualStyle: "dark-tech" }),
      },
      {
        id: "add-new",
        type: "add-slide",
        slide: newSlide,
        index: 0,
      },
    ];
    const draft = applyCommandsToDraft(presentation([oldSlide]), commands);

    expect(draft.slides.map((slide) => slide.id)).toEqual(["new-svg-slide"]);
    expect(collectAffectedSlideIds(commands, draft)).toEqual(["new-svg-slide"]);
  });

  it("PreviewSlide summarizes svgPage and narrative without requesting a thumbnail", async () => {
    const slide = svgSlide("preview-svg");
    const result = await previewSlideTool.execute(
      { slideId: slide.id, includeThumbnail: false },
      toolContext(presentation([slide])),
    );

    expect(result.thumbnail).toBeNull();
    expect(result.preview.svgPage).toEqual({
      sourcePath: "slides/svg/preview-svg.svg",
      sha256: sha256(SVG_MARKUP),
      width: 1280,
      height: 720,
      resourceCount: 0,
    });
    expect(result.preview.narrative).toEqual(NARRATIVE);
    expect(result.preview.description).toContain("Complete-page SVG");
    expect(result.preview.description).toContain("rhythm=anchor");
  });
});
