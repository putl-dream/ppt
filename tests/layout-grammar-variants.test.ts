import { describe, expect, it } from "vitest";

import { LayoutValidator } from "../src/main/deck/validators/layout-validator";
import { applyLayout } from "../src/shared/layout";
import { layoutGrammarRegistry } from "../src/shared/layout-grammar";
import { getLayoutSlotRect, listLayoutSlots } from "../src/shared/layout-slots";
import type { Presentation, Slide, TextElement } from "../src/shared/presentation";
import {
  TEST_DESIGN_SYSTEM,
  testSlideStyle,
  type TestDesignSystemOverrides,
} from "./design-engine-test-utils";

const BASE_SYSTEM: TestDesignSystemOverrides = {
  visualStyle: "soft-rounded",
  colorScheme: "business-blue",
  readingMode: "balanced",
};

function textElement(text: string, fontSize = 20): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 0,
    y: 0,
    width: 300,
    height: 80,
    text,
    fontSize,
  };
}

function processSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    title: "Delivery process",
    elements: ["Discover", "Design", "Build", "Validate"].map((text) => textElement(text)),
  };
}

function caseSlide(withImage = false): Slide {
  return {
    id: crypto.randomUUID(),
    title: "Business impact",
    elements: [
      textElement("Deployment became faster while quality remained stable."),
      textElement("67% faster", 32),
      ...(withImage ? [{
        id: crypto.randomUUID(),
        type: "image" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        url: "data:image/png;base64,AA==",
        borderRadius: 0,
      }] : []),
    ],
  };
}

function imageGridSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    title: "Evidence gallery",
    elements: [
      ...[0, 1, 2].map((index) => ({
        id: crypto.randomUUID(),
        type: "image" as const,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        url: `data:image/png;base64,${index}`,
        borderRadius: 0,
      })),
      ...["Primary evidence", "Detail A", "Detail B"].map((text) => textElement(text, 16)),
    ],
  };
}

function expectNoLayoutErrorsOrUnexpectedOverlaps(slide: Slide): void {
  const presentation: Presentation = {
    id: crypto.randomUUID(),
    title: "Grammar QA",
    revision: 1,
    designSystem: TEST_DESIGN_SYSTEM,
    slides: [slide],
  };
  const issues = new LayoutValidator().validate(presentation);
  expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(issues.filter((issue) => issue.message.includes("overlap"))).toEqual([]);
}

describe("layout grammar variants", () => {
  it("registers the high-frequency grammar families and their supported variants", () => {
    expect(layoutGrammarRegistry.get("section")?.supportedVariants).toEqual([
      "centered", "editorial-split", "band",
    ]);
    expect(layoutGrammarRegistry.get("process")?.supportedVariants).toEqual([
      "cards", "timeline", "path", "steps",
    ]);
    expect(layoutGrammarRegistry.get("case")?.supportedVariants).toEqual([
      "split", "metric-focus", "evidence",
    ]);
    expect(layoutGrammarRegistry.get("image-grid")?.supportedVariants).toEqual([
      "grid", "hero-caption", "filmstrip", "evidence-wall",
    ]);
    expect(layoutGrammarRegistry.get("toc")?.supportedVariants).toEqual([
      "numbered-list", "chapter-rail", "editorial-index",
    ]);
    expect(layoutGrammarRegistry.get("concept")?.supportedVariants).toEqual([
      "cards", "statement-stack", "editorial-columns",
    ]);
    expect(layoutGrammarRegistry.get("comparison")?.supportedVariants).toEqual([
      "split", "before-after", "verdict",
    ]);
    expect(layoutGrammarRegistry.get("quote")?.supportedVariants).toEqual([
      "centered-card", "editorial-pullquote", "quote-band",
    ]);
    expect(layoutGrammarRegistry.get("summary")?.supportedVariants).toEqual([
      "action-list", "three-takeaways", "closing-checklist",
    ]);
  });

  it("reads image slot geometry from the applied grammar result", () => {
    expect(listLayoutSlots("section", "editorial-split")).toContain("hero");
    const splitSlide = caseSlide(true);
    const evidenceSlide = caseSlide(true);
    const split = applyLayout(splitSlide, "case", testSlideStyle(splitSlide, BASE_SYSTEM), {
      grammarVariant: "split",
    });
    const evidence = applyLayout(
      evidenceSlide,
      "case",
      testSlideStyle(evidenceSlide, BASE_SYSTEM),
      { grammarVariant: "evidence" },
    );
    const splitRect = getLayoutSlotRect(split, "side");
    const evidenceRect = getLayoutSlotRect(evidence, "side");
    expect(evidenceRect?.width).toBeGreaterThan(splitRect?.width ?? 0);
    expect(evidenceRect?.x).toBeLessThan(splitRect?.x ?? 0);
  });

  it("produces distinct section silhouettes", () => {
    const base: Slide = {
      id: crypto.randomUUID(),
      title: "Chapter One",
      elements: [textElement("Chapter One", 52), textElement("A focused transition")],
    };
    const centered = applyLayout(base, "section", testSlideStyle(base, BASE_SYSTEM), {
      grammarVariant: "centered",
    });
    const editorialSystem: TestDesignSystemOverrides = {
      ...BASE_SYSTEM,
      visualStyle: "editorial",
    };
    const editorial = applyLayout(base, "section", testSlideStyle(base, editorialSystem), {
      grammarVariant: "editorial-split",
    });
    const centeredTitle = centered.elements.find((element) => element.type === "text" && element.text === "Chapter One");
    const editorialTitle = editorial.elements.find((element) => element.type === "text" && element.text === "Chapter One");

    expect(centered.grammarVariant).toBe("centered");
    expect(editorial.grammarVariant).toBe("editorial-split");
    expect(centeredTitle?.x).not.toBe(editorialTitle?.x);
    expectNoLayoutErrorsOrUnexpectedOverlaps(centered);
    expectNoLayoutErrorsOrUnexpectedOverlaps(editorial);
  });

  it.each(["cards", "timeline", "path", "steps"] as const)(
    "renders a valid process %s variant",
    (variant) => {
      const slide = processSlide();
      const laidOut = applyLayout(slide, "process", testSlideStyle(slide, BASE_SYSTEM), {
        grammarVariant: variant,
      });
      expect(laidOut.grammarVariant).toBe(variant);
      expect(laidOut.elements.filter((element) => element.id.startsWith("num-"))).toHaveLength(4);
      expectNoLayoutErrorsOrUnexpectedOverlaps(laidOut);
    },
  );

  it("infers path process grammar from design tokens", () => {
    const slide = processSlide();
    const laidOut = applyLayout(slide, "process", testSlideStyle(slide, {
      ...BASE_SYSTEM,
      visualStyle: "blueprint",
    }));
    expect(laidOut.grammarVariant).toBe("path");
  });

  it("switches case composition between metric focus and visual evidence", () => {
    const metricSlide = caseSlide();
    const metric = applyLayout(metricSlide, "case", testSlideStyle(metricSlide, {
      ...BASE_SYSTEM,
      visualStyle: "dark-tech",
    }), {
      grammarVariant: "metric-focus",
    });
    const evidenceSlide = caseSlide(true);
    const evidence = applyLayout(evidenceSlide, "case", testSlideStyle(evidenceSlide, {
      ...BASE_SYSTEM,
      visualStyle: "soft-rounded",
    }), {
      grammarVariant: "evidence",
    });
    const evidenceImage = evidence.elements.find((element) => element.type === "image");

    expect(metric.elements.some((element) => element.type === "text" && element.textRole === "metric")).toBe(true);
    expect(evidenceImage?.type === "image" ? evidenceImage.width : 0).toBeGreaterThan(600);
    expectNoLayoutErrorsOrUnexpectedOverlaps(metric);
    expectNoLayoutErrorsOrUnexpectedOverlaps(evidence);
  });

  it("does not emit an empty side card for a narrative-only split case", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "Business impact",
      elements: [textElement("One focused narrative")],
    };
    const laidOut = applyLayout(slide, "case", testSlideStyle(slide, BASE_SYSTEM), {
      grammarVariant: "split",
    });
    const cards = laidOut.elements.filter(
      (element) =>
        element.type === "shape"
        && element.provenance === "layout"
        && element.shapeType === "roundedRect"
        && element.fillOpacity === undefined,
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ x: 120 });
    expect(cards[0].width).toBeGreaterThan(580);
    expect(cards[0].width).toBeLessThan(630);
    expectNoLayoutErrorsOrUnexpectedOverlaps(laidOut);
  });

  it.each(["grid", "hero-caption", "filmstrip", "evidence-wall"] as const)(
    "renders a valid image-grid %s variant",
    (variant) => {
      const slide = imageGridSlide();
      const laidOut = applyLayout(slide, "image-grid", testSlideStyle(slide, {
        ...BASE_SYSTEM,
        visualStyle: "soft-rounded",
      }), {
        grammarVariant: variant,
      });
      expect(laidOut.grammarVariant).toBe(variant);
      expect(laidOut.elements.filter((element) => element.type === "image").length).toBeGreaterThan(0);
      expectNoLayoutErrorsOrUnexpectedOverlaps(laidOut);
    },
  );

  it.each([
    ["toc", ["numbered-list", "chapter-rail", "editorial-index"]],
    ["concept", ["cards", "statement-stack", "editorial-columns"]],
    ["comparison", ["split", "before-after", "verdict"]],
    ["quote", ["centered-card", "editorial-pullquote", "quote-band"]],
    ["summary", ["action-list", "three-takeaways", "closing-checklist"]],
  ] as const)("renders distinct, valid %s variants", (layout, variants) => {
    const signatures = variants.map((variant) => {
      const texts = layout === "quote"
        ? ["A strong point of view", "— Author"]
        : layout === "comparison"
          ? ["Before", "After", "Fragmented", "Connected"]
          : ["First conclusion", "Second conclusion", "Third conclusion"];
      const slide: Slide = {
        id: crypto.randomUUID(),
        title: `${layout} grammar`,
        elements: texts.map((text) => textElement(text)),
      };
      const laidOut = applyLayout(slide, layout, testSlideStyle(slide, BASE_SYSTEM), {
        grammarVariant: variant,
      });
      expect(laidOut.grammarVariant).toBe(variant);
      expect(laidOut.elements.filter((element) => element.type === "text").length)
        .toBeGreaterThanOrEqual(texts.length);
      expectNoLayoutErrorsOrUnexpectedOverlaps(laidOut);
      return laidOut.elements
        .filter((element) => element.provenance === "layout")
        .map((element) => `${element.type}:${element.x},${element.y},${element.width},${element.height}`)
        .join("|");
    });
    expect(new Set(signatures).size).toBe(variants.length);
  });
});
