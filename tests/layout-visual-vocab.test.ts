import { describe, expect, it } from "vitest";
import { applyLayout } from "../src/shared/layout";
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
  it.each(LAYOUTS)("applies roundedRect cards with shadow on %s layout", (layout) => {
    const slide: Slide =
      layout === "image-grid"
        ? {
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
              },
            ],
          }
        : makeSlide("Test", "Body content");

    const laidOut = applyLayout(slide, layout, "ocean", "cyan");
    const cards = laidOut.elements.filter(isLayoutCard) as ShapeElement[];

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.shapeType === "roundedRect")).toBe(true);
    expect(cards.every((card) => card.cornerRadius != null)).toBe(true);
    expect(cards.every((card) => card.shadow != null)).toBe(true);
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

    const laidOut = applyLayout(slide, "process", "nordic", "cyan");
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
    const laidOut = applyLayout(makeSlide("Points", "One"), "concept", "nordic", "cyan");
    expect(slideNeedsLayoutChoice(laidOut)).toBe(false);
  });

  it("re-applying layout does not duplicate roundedRect cards", () => {
    const first = applyLayout(makeSlide("Points", "One"), "concept", "nordic", "cyan");
    const second = applyLayout(first, "concept", "nordic", "cyan");
    const cards = second.elements.filter(isLayoutCard);
    expect(cards.length).toBe(1);
  });
});
