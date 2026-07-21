import { describe, expect, it } from "vitest";
import { applyLayout } from "../src/shared/layout";
import type { Presentation, Slide } from "../src/shared/presentation";
import { LayoutValidator } from "../src/main/deck/validators/layout-validator";
import { StyleValidator } from "../src/main/deck/validators/style-validator";
import { AssetValidator } from "../src/main/deck/validators/asset-validator";
import { TEST_DESIGN_SYSTEM, testSlideStyle } from "./design-engine-test-utils";

function createPresentation(slides: Slide[], overrides: Partial<Presentation> = {}): Presentation {
  return {
    id: "pres-1",
    title: "Validation Test Deck",
    revision: 1,
    designSystem: TEST_DESIGN_SYSTEM,
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

  it("accepts an intentional full-bleed commercial cover image", () => {
    const slide: Slide = {
      id: "slide-full-bleed",
      title: "Full bleed",
      layout: "cover",
      sceneRef: {
        packId: "editorial-business",
        sceneId: "cinematic-cover",
        variantId: "full-bleed",
      },
      elements: [{
        id: "hero-image",
        type: "image",
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        url: "assets/hero.png",
        borderRadius: 0,
        imageSlot: "hero",
      }],
    };

    const issues = validator.validate(createPresentation([slide]));
    expect(issues.filter((issue) => issue.message.includes("outside the safe margin"))).toEqual([]);
  });

  it("still rejects a full-bleed cover image that extends beyond the canvas", () => {
    const slide: Slide = {
      id: "slide-overflowing-full-bleed",
      title: "Overflowing full bleed",
      layout: "cover",
      sceneRef: {
        packId: "editorial-business",
        sceneId: "cinematic-cover",
        variantId: "full-bleed",
      },
      elements: [{
        id: "hero-image",
        type: "image",
        x: -1,
        y: 0,
        width: 1281,
        height: 720,
        url: "assets/hero.png",
        borderRadius: 0,
        imageSlot: "hero",
      }],
    };

    const issues = validator.validate(createPresentation([slide]));
    expect(issues.some((issue) => issue.message.includes("outside the safe margin"))).toBe(true);
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
    const base: Slide = {
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
      };
    const slide = applyLayout(base, "concept", testSlideStyle(base));

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

describe("AssetValidator", () => {
  const validator = new AssetValidator();

  it("blocks remote images and reports missing provenance metadata", () => {
    const slide: Slide = {
      id: "slide-evidence",
      title: "Evidence",
      layout: "case",
      elements: [{
        id: "image-remote",
        type: "image",
        provenance: "asset",
        x: 760,
        y: 180,
        width: 360,
        height: 320,
        url: "https://cdn.example.com/evidence.png",
        borderRadius: 0,
        asset: { sourceUrl: "https://cdn.example.com/evidence.png" },
      }],
    };

    const issues = validator.validate(createPresentation([slide]));
    expect(issues.some((issue) => issue.severity === "error" && issue.message.includes("remote URL"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("source page"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("license"))).toBe(true);
  });

  it("requires explicit approval for unverified commercial assets", () => {
    const slide: Slide = {
      id: "slide-license",
      title: "Licensed evidence",
      layout: "concept",
      elements: [{
        id: "image-license",
        type: "image",
        provenance: "asset",
        x: 120,
        y: 180,
        width: 400,
        height: 240,
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        borderRadius: 0,
        asset: {
          sourceUrl: "https://cdn.example.com/evidence.png",
          sourcePageUrl: "https://example.com/evidence",
          licenseStatus: "unknown",
        },
      }],
    };

    const blocked = validator.validate(createPresentation([slide]));
    const approved = validator.validate(createPresentation([slide]), {
      allowUnverifiedAssets: true,
    });
    expect(blocked).toEqual(expect.arrayContaining([expect.objectContaining({
      severity: "error",
      message: expect.stringContaining("not had its commercial license verified"),
    })]));
    expect(approved).toEqual(expect.arrayContaining([expect.objectContaining({
      severity: "warning",
      message: expect.stringContaining("not had its commercial license verified"),
    })]));
  });

  it("always blocks restricted commercial assets", () => {
    const slide: Slide = {
      id: "slide-restricted",
      title: "Restricted evidence",
      layout: "concept",
      elements: [{
        id: "image-restricted",
        type: "image",
        provenance: "asset",
        x: 120,
        y: 180,
        width: 400,
        height: 240,
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        borderRadius: 0,
        asset: {
          sourceUrl: "https://cdn.example.com/restricted.png",
          sourcePageUrl: "https://example.com/restricted",
          licenseStatus: "restricted",
        },
      }],
    };

    const issues = validator.validate(createPresentation([slide]), {
      allowUnverifiedAssets: true,
    });
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({
      severity: "error",
      message: expect.stringContaining("marked as restricted"),
    })]));
  });

  it("blocks image-dependent layouts without their required visual asset", () => {
    const slide: Slide = {
      id: "slide-evidence",
      title: "Evidence",
      layout: "case",
      grammarVariant: "evidence",
      elements: [{
        id: "body",
        type: "text",
        x: 120,
        y: 220,
        width: 500,
        height: 180,
        text: "Evidence narrative",
        fontSize: 24,
      }],
    };

    const issues = validator.validate(createPresentation([slide]), {
      workspaceRoot: "C:\\workspace",
    });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("missing a required image"),
      }),
    ]));
  });

  it("blocks local image paths outside the workspace", () => {
    const slide: Slide = {
      id: "slide-image",
      title: "Image",
      layout: "concept",
      elements: [{
        id: "image-outside",
        type: "image",
        x: 120,
        y: 220,
        width: 400,
        height: 240,
        url: "C:\\outside\\image.png",
        borderRadius: 0,
      }],
    };

    const issues = validator.validate(createPresentation([slide]), {
      workspaceRoot: "C:\\workspace",
    });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("outside the workspace"),
      }),
    ]));
  });
});
