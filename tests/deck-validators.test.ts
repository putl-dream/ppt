import { describe, expect, it } from "vitest";
import { applyLayout } from "../src/shared/layout";
import type { Presentation, Slide } from "../src/shared/presentation";
import { LayoutValidator } from "../src/main/deck/validators/layout-validator";
import { StyleValidator } from "../src/main/deck/validators/style-validator";
import { deckGenerationService } from "../src/main/deck/deck-generation-service";

function createPresentation(slides: Slide[], overrides: Partial<Presentation> = {}): Presentation {
  return {
    id: "pres-1",
    title: "Validation Test Deck",
    revision: 1,
    theme: "ocean",
    palette: "cyan",
    slides,
    ...overrides,
  };
}

describe("LayoutValidator", () => {
  const validator = new LayoutValidator();

  it("flags out-of-bounds elements as errors", () => {
    const slide: Slide = {
      id: "slide-cover",
      title: "Cover",
      layout: "cover",
      elements: [
        {
          id: "text-1",
          type: "text",
          x: 10,
          y: 10,
          width: 200,
          height: 80,
          text: "Too close to edge",
          fontSize: 48,
        },
      ],
    };

    const issues = validator.validate(createPresentation([slide]));
    expect(issues.some((issue) => issue.severity === "error" && issue.category === "layout")).toBe(true);
  });

  it("flags empty comparison layout slides", () => {
    const slide: Slide = {
      id: "slide-comparison",
      title: "Before vs After",
      layout: "comparison",
      elements: [],
    };

    const issues = validator.validate(createPresentation([slide]));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slideId: "slide-comparison",
          severity: "error",
          message: expect.stringContaining("comparison"),
        }),
      ]),
    );
  });

  it("detects empty comparison columns after layout", () => {
    const slide: Slide = {
      id: "slide-comparison",
      title: "Before vs After",
      layout: "comparison",
      elements: [
        {
          id: "left-a",
          type: "text",
          x: 144,
          y: 220,
          width: 432,
          height: 180,
          text: "Left column A",
          fontSize: 24,
        },
        {
          id: "left-b",
          type: "text",
          x: 144,
          y: 320,
          width: 432,
          height: 120,
          text: "Left column B",
          fontSize: 22,
        },
      ],
    };

    const issues = validator.validate(createPresentation([slide]));
    expect(issues.some((issue) => issue.message.includes("empty column"))).toBe(true);
  });

  it("accepts a valid concept layout slide", () => {
    const slide = applyLayout(
      {
        id: "slide-concept",
        title: "Core Idea",
        elements: [
          {
            id: "body",
            type: "text",
            x: 0,
            y: 0,
            width: 700,
            height: 300,
            text: "Key point one\nKey point two",
            fontSize: 24,
          },
        ],
      },
      "concept",
      "ocean",
      "cyan",
    );

    const issues = validator.validate(createPresentation([slide]));
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});

describe("StyleValidator", () => {
  const validator = new StyleValidator();

  it("flags repeated slide titles", () => {
    const presentation = createPresentation([
      { id: "s1", title: "Duplicate", elements: [] },
      { id: "s2", title: "Duplicate", elements: [] },
    ]);

    const issues = validator.validate(presentation);
    expect(issues.some((issue) => issue.category === "consistency")).toBe(true);
  });

  it("flags chrome title duplication on content slides", () => {
    const slide: Slide = {
      id: "slide-concept",
      title: "Architecture",
      layout: "concept",
      elements: [
        {
          id: "dup-title",
          type: "text",
          x: 120,
          y: 200,
          width: 1040,
          height: 60,
          text: "Architecture",
          fontSize: 36,
        },
        {
          id: "body",
          type: "text",
          x: 120,
          y: 280,
          width: 1040,
          height: 200,
          text: "Body content",
          fontSize: 24,
        },
      ],
    };

    const issues = validator.validate(createPresentation([slide]));
    expect(issues.some((issue) => issue.message.includes("duplicates the chrome title"))).toBe(true);
  });

  it("passes cover slides without theme duplication checks on canvas", () => {
    const slide: Slide = {
      id: "slide-cover",
      title: "Launch",
      layout: "cover",
      elements: [
        {
          id: "title",
          type: "text",
          x: 120,
          y: 200,
          width: 1040,
          height: 160,
          text: "Launch",
          fontSize: 56,
        },
      ],
    };

    const issues = validator.validate(createPresentation([slide]));
    expect(issues.filter((issue) => issue.message.includes("duplicates the chrome title"))).toEqual([]);
  });
});

describe("DeckGenerationService.validateAfterBatch", () => {
  it("runs layout and style validators for a batch scope", () => {
    const batchSlide = applyLayout(
      {
        id: "batch-slide",
        title: "Batch Slide",
        elements: [
          {
            id: "body",
            type: "text",
            x: 0,
            y: 0,
            width: 700,
            height: 300,
            text: "Batch content",
            fontSize: 24,
          },
        ],
      },
      "concept",
      "ocean",
      "cyan",
    );
    const otherSlide: Slide = {
      id: "other-slide",
      title: "Broken",
      layout: "comparison",
      elements: [],
    };

    const result = deckGenerationService.validateAfterBatch({
      presentation: createPresentation([batchSlide, otherSlide]),
      batchIndex: 2,
      slideIds: ["batch-slide"],
    });

    expect(result.batchIndex).toBe(2);
    expect(result.valid).toBe(true);
    expect(result.issues.every((issue) => issue.slideId === "batch-slide" || !issue.slideId)).toBe(true);
    expect(result.issues.some((issue) => issue.slideId === "other-slide")).toBe(false);
  });
});
