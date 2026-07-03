import { describe, expect, it } from "vitest";
import { applyLayout } from "../src/shared/layout";
import type { Slide } from "../src/shared/presentation";
import {
  countSlidesNeedingLayout,
  presentationNeedsLayoutChoice,
  slideNeedsLayoutChoice,
} from "../src/shared/presentation-draft";

describe("presentation-draft", () => {
  it("detects slides without layout cards", () => {
    const slide: Slide = {
      id: "s1",
      title: "核心观点",
      layout: "concept",
      elements: [
        {
          id: "body",
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 40,
          text: "要点一",
          fontSize: 20,
        },
      ],
    };

    expect(slideNeedsLayoutChoice(slide)).toBe(true);
    expect(presentationNeedsLayoutChoice({ id: "p", title: "T", revision: 1, slides: [slide] })).toBe(true);
    expect(countSlidesNeedingLayout({ id: "p", title: "T", revision: 1, slides: [slide] })).toBe(1);
  });

  it("returns false after applyLayout adds cards", () => {
    const slide: Slide = {
      id: "s1",
      title: "流程",
      layout: "process",
      elements: [
        {
          id: "step-1",
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 40,
          text: "步骤一",
          fontSize: 20,
        },
        {
          id: "step-2",
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 40,
          text: "步骤二",
          fontSize: 20,
        },
      ],
    };

    const laidOut = applyLayout(slide, "process", "ocean", "cyan");
    expect(slideNeedsLayoutChoice(laidOut)).toBe(false);
    expect(laidOut.elements.some((el) => el.type === "shape" && el.shapeType === "arrow")).toBe(true);
  });
});
