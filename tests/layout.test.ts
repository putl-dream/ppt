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

  it("places case layout image into the side slot", () => {
    const descId = crypto.randomUUID();
    const imageId = crypto.randomUUID();
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "关键指标",
      elements: [
        {
          id: descId,
          type: "text",
          x: 0,
          y: 0,
          width: 400,
          height: 200,
          text: "项目说明",
          fontSize: 20,
        },
        {
          id: imageId,
          type: "image",
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          url: "https://example.com/chart.png",
          borderRadius: 0,
        },
      ],
    };

    const laidOut = applyLayout(slide, "case", "ocean", "cyan");
    const image = laidOut.elements.find(
      (element) => element.type === "image" && element.id === imageId,
    );

    expect(image?.type === "image" ? image.imageSlot : undefined).toBe("side");
    expect(image?.x).toBeGreaterThanOrEqual(760);
    expect(image?.width).toBeGreaterThan(300);
  });

  it("assigns metric textRole on case layout when no image is present", () => {
    const metricId = crypto.randomUUID();
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "增长数据",
      elements: [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 0,
          y: 0,
          width: 400,
          height: 200,
          text: "年度增长",
          fontSize: 20,
        },
        {
          id: metricId,
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          text: "76%",
          fontSize: 32,
        },
      ],
    };

    const laidOut = applyLayout(slide, "case", "ocean", "cyan");
    const metric = laidOut.elements.find(
      (element) => element.type === "text" && element.id === metricId,
    );

    expect(metric?.type === "text" ? metric.textRole : undefined).toBe("metric");
    expect(metric?.type === "text" ? metric.fontFamily : undefined).toBe("sans");
    expect(metric?.x).toBeGreaterThanOrEqual(760);
  });

  it("assigns serif cover title on nordic theme and sans on ocean", () => {
    const titleId = crypto.randomUUID();
    const nordicSlide: Slide = {
      id: crypto.randomUUID(),
      title: "年中汇报",
      elements: [
        {
          id: titleId,
          type: "text",
          x: 0,
          y: 0,
          width: 800,
          height: 120,
          text: "年中汇报",
          fontSize: 56,
        },
      ],
    };

    const nordic = applyLayout(nordicSlide, "cover", "nordic", "cyan");
    const nordicTitle = nordic.elements.find(
      (element) => element.type === "text" && element.id === titleId,
    );
    expect(nordicTitle?.type === "text" ? nordicTitle.fontFamily : undefined).toBe("serif");

    const oceanSlide: Slide = {
      ...nordicSlide,
      id: crypto.randomUUID(),
      elements: [{ ...nordicSlide.elements[0], id: titleId }],
    };
    const ocean = applyLayout(oceanSlide, "cover", "ocean", "cyan");
    const oceanTitle = ocean.elements.find(
      (element) => element.type === "text" && element.id === titleId,
    );
    expect(oceanTitle?.type === "text" ? oceanTitle.fontFamily : undefined).toBe("sans");
  });

  it("places concept layout images into grid slots by index", () => {
    const textA = crypto.randomUUID();
    const textB = crypto.randomUUID();
    const imageA = crypto.randomUUID();
    const imageB = crypto.randomUUID();
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "核心能力",
      elements: [
        {
          id: textA,
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          text: "能力一",
          fontSize: 20,
        },
        {
          id: textB,
          type: "text",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          text: "能力二",
          fontSize: 20,
        },
        {
          id: imageA,
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          url: "https://example.com/a.png",
          borderRadius: 0,
        },
        {
          id: imageB,
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          url: "https://example.com/b.png",
          borderRadius: 0,
        },
      ],
    };

    const laidOut = applyLayout(slide, "concept", "ocean", "cyan");
    const imgA = laidOut.elements.find(
      (element) => element.type === "image" && element.id === imageA,
    );
    const imgB = laidOut.elements.find(
      (element) => element.type === "image" && element.id === imageB,
    );

    expect(imgA?.type === "image" ? imgA.imageSlot : undefined).toBe("grid-0");
    expect(imgB?.type === "image" ? imgB.imageSlot : undefined).toBe("grid-1");
    expect(imgA?.x).toBeLessThan(imgB?.x ?? 0);
  });

  it("sets hero backgroundVariant for cover and default for concept", () => {
    const cover = applyLayout(
      {
        id: crypto.randomUUID(),
        title: "封面",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 0,
            y: 0,
            width: 800,
            height: 120,
            text: "封面",
            fontSize: 56,
          },
        ],
      },
      "cover",
      "nordic",
      "cyan",
    );
    const concept = applyLayout(
      {
        id: crypto.randomUUID(),
        title: "要点",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 0,
            y: 0,
            width: 400,
            height: 80,
            text: "要点一",
            fontSize: 20,
          },
        ],
      },
      "concept",
      "nordic",
      "cyan",
    );

    expect(cover.backgroundVariant).toBe("hero");
    expect(concept.backgroundVariant).toBe("default");
  });
});
