import { describe, expect, it } from "vitest";
import { applyLayout } from "../src/shared/layout";
import { testSlideStyle } from "./design-engine-test-utils";
import { isLayoutCard } from "../src/shared/layout-shape-utils";
import { slideNeedsLayoutChoice } from "../src/shared/presentation-draft";
import type { ShapeElement, Slide } from "../src/shared/presentation";

function makeSlide(title: string, body: string): Slide {
  return {
    id: crypto.randomUUID(),
    title,
    elements: [
      {
        id: crypto.randomUUID(),
        type: "text",
        x: 0,
        y: 0,
        width: 400,
        height: 80,
        text: body,
        fontSize: 20,
      },
    ],
  };
}

const LAYOUTS = [
  "process",
  "architecture",
  "toc",
  "quote",
  "image-grid",
  "summary",
] as const;

describe("layout visual vocabulary", () => {
  it.each(LAYOUTS.filter((l) => l !== "image-grid"))(
    "applies soft-rounded cards with shadow on %s layout",
    (layout) => {
      const slide = makeSlide("Test", "Body content");
      const laidOut = applyLayout(
        slide,
        layout,
        testSlideStyle(slide, { visualStyle: "soft-rounded" }),
      );
      const cards = laidOut.elements.filter(isLayoutCard) as ShapeElement[];

      expect(cards.length).toBeGreaterThan(0);
      expect(cards.every((card) => card.shapeType === "roundedRect")).toBe(true);
      expect(cards.every((card) => card.cornerRadius != null)).toBe(true);
      expect(cards.every((card) => card.shadow != null)).toBe(true);
    },
  );

  it("applies roundedRect cards on image-grid layout", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "Gallery",
      elements: [
        {
          id: crypto.randomUUID(),
          type: "image",
          x: 0,
          y: 0,
          width: 200,
          height: 160,
          url: "https://example.com/a.png",
          borderRadius: 0,
        },
      ],
    };
    const laidOut = applyLayout(
      slide,
      "image-grid",
      testSlideStyle(slide, { visualStyle: "soft-rounded" }),
    );
    const cards = laidOut.elements.filter(isLayoutCard) as ShapeElement[];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]?.shapeType).toBe("roundedRect");
  });

  it("process layout includes numbered step badges", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "Steps",
      elements: [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          text: "Step A",
          fontSize: 20,
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          text: "Step B",
          fontSize: 20,
        },
      ],
    };

    const laidOut = applyLayout(
      slide,
      "process",
      testSlideStyle(slide, { visualStyle: "soft-rounded" }),
    );
    const badges = laidOut.elements.filter(
      (el) => el.type === "shape" && el.id.startsWith("badge-"),
    );
    const numbers = laidOut.elements.filter(
      (el) => el.type === "text" && el.id.startsWith("num-"),
    );

    expect(badges.length).toBe(2);
    expect(numbers.length).toBe(2);
    expect(badges.every((el) => el.type === "shape" && el.shadow != null)).toBe(true);
  });

  it("recognizes roundedRect cards for layout choice detection", () => {
    const base = makeSlide("Points", "One");
    const laidOut = applyLayout(base, "concept", testSlideStyle(base));
    expect(slideNeedsLayoutChoice(laidOut)).toBe(false);
  });

  it("re-applying layout does not duplicate roundedRect cards", () => {
    const base = makeSlide("Points", "One");
    const first = applyLayout(base, "concept", testSlideStyle(base));
    const second = applyLayout(first, "concept", testSlideStyle(first));
    const cards = second.elements.filter(isLayoutCard);
    expect(cards.length).toBe(1);
  });

  it("projects sharp-flat and soft-elevated style geometry into cards", () => {
    const slide = makeSlide("Style execution", "One decisive point");
    const swiss = applyLayout(
      slide,
      "concept",
      testSlideStyle(slide, { visualStyle: "swiss-minimal" }),
      { grammarVariant: "cards" },
    );
    const soft = applyLayout(
      slide,
      "concept",
      testSlideStyle(slide, { visualStyle: "soft-rounded" }),
      { grammarVariant: "cards" },
    );
    const swissCard = swiss.elements.find(isLayoutCard) as ShapeElement;
    const softCard = soft.elements.find(isLayoutCard) as ShapeElement;

    expect(swissCard.shapeType).toBe("rectangle");
    expect(swissCard.cornerRadius).toBe(0);
    expect(swissCard.shadow).toBeUndefined();
    expect(softCard.shapeType).toBe("roundedRect");
    expect(softCard.cornerRadius).toBeGreaterThan(0);
    expect(softCard.shadow).toBeDefined();
  });

  it("uses reading mode to expand card gutters and text scale", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "Reading rhythm",
      elements: [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 0,
          y: 0,
          width: 400,
          height: 80,
          text: "First idea",
          fontSize: 20,
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 0,
          y: 0,
          width: 400,
          height: 80,
          text: "Second idea",
          fontSize: 20,
        },
      ],
    };
    const textMode = applyLayout(
      slide,
      "concept",
      testSlideStyle(slide, {
        visualStyle: "soft-rounded",
        readingMode: "text",
      }),
      { grammarVariant: "cards" },
    );
    const presentationMode = applyLayout(
      slide,
      "concept",
      testSlideStyle(slide, {
        visualStyle: "soft-rounded",
        readingMode: "presentation",
      }),
      { grammarVariant: "cards" },
    );
    const textCards = textMode.elements.filter(isLayoutCard) as ShapeElement[];
    const presentationCards = presentationMode.elements.filter(isLayoutCard) as ShapeElement[];
    const textGap = textCards[1].x - (textCards[0].x + textCards[0].width);
    const presentationGap = presentationCards[1].x
      - (presentationCards[0].x + presentationCards[0].width);
    const textBody = textMode.elements.find((element) => element.type === "text");
    const presentationBody = presentationMode.elements.find((element) => element.type === "text");

    expect(presentationGap).toBeGreaterThan(textGap);
    expect(presentationBody?.type === "text" ? presentationBody.fontSize : 0)
      .toBeGreaterThan(textBody?.type === "text" ? textBody.fontSize : 0);
  });
});
