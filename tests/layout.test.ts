import { describe, expect, it } from "vitest";
import { applyLayout } from "../src/shared/layout";
import type { Slide } from "../src/shared/presentation";

describe("applyLayout", () => {
  it("does not treat the only body text as the slide title for concept layout", () => {
    const bodyId = crypto.randomUUID();
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "核心观点",
      elements: [
        {
          id: bodyId,
          type: "text",
          x: 0,
          y: 0,
          width: 700,
          height: 300,
          text: "• 数据先变成 Presentation JSON\n• Agent 通过命令修改幻灯片",
          fontSize: 30,
        },
      ],
    };

    const laidOut = applyLayout(slide, "concept", "ocean", "cyan");
    const bodyElement = laidOut.elements.find(
      (element) => element.type === "text" && element.id === bodyId,
    );

    expect(bodyElement).toBeDefined();
    expect(bodyElement?.type === "text" ? bodyElement.text : "").toContain("Presentation JSON");
    expect(laidOut.elements.some(
      (element) => element.type === "text" && element.text.trim() === "核心观点",
    )).toBe(false);
    expect(laidOut.elements.some(
      (element) => element.type === "shape" && element.shapeType === "line",
    )).toBe(false);
  });

  it("places comparison columns from separate body texts", () => {
    const leftId = crypto.randomUUID();
    const rightId = crypto.randomUUID();
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "流程对比",
      elements: [
        {
          id: leftId,
          type: "text",
          x: 0,
          y: 0,
          width: 400,
          height: 200,
          text: "左侧内容",
          fontSize: 26,
        },
        {
          id: rightId,
          type: "text",
          x: 0,
          y: 0,
          width: 400,
          height: 200,
          text: "右侧内容",
          fontSize: 26,
        },
      ],
    };

    const laidOut = applyLayout(slide, "comparison", "ocean", "cyan");
    const left = laidOut.elements.find((element) => element.id === leftId);
    const right = laidOut.elements.find((element) => element.id === rightId);

    expect(left?.x).toBeLessThan(680);
    expect(right?.x).toBeGreaterThanOrEqual(680);
  });
});
