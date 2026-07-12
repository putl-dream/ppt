import { describe, expect, it } from "vitest";
import { applyLayout } from "../src/shared/layout";
import { TEST_DESIGN_SYSTEM, testSlideStyle } from "./design-engine-test-utils";
import { getLayoutSlotRect, listLayoutSlots } from "../src/shared/layout-slots";
import { validateDeckRhythm } from "../src/shared/deck-rhythm";
import { insertSlideImageTool } from "../src/main/agent/tools/core/insert-slide-image";
import { validateDeckLayoutTool } from "../src/main/agent/tools/deferred/validate-deck-layout";
import { previewSlideTool } from "../src/main/agent/tools/deferred/preview-slide";
import type { Presentation, Slide } from "../src/shared/presentation";
import type { ToolContext } from "../src/main/agent/tools/tool-definition";

function makeContext(presentation: Presentation): ToolContext {
  return {
    presentation,
    selectedElementIds: [],
    discoverySession: { discoveredToolNames: new Set() },
    registry: {} as ToolContext["registry"],
    messageHistory: [],
  };
}

describe("P1 layouts", () => {
  it("renders toc with numbered rows", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "目录",
      elements: [
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 40, text: "上半年", fontSize: 20 },
        { id: "b", type: "text", x: 0, y: 0, width: 200, height: 40, text: "下半年", fontSize: 20 },
      ],
    };
    const laidOut = applyLayout(slide, "toc", testSlideStyle(slide));
    expect(laidOut.elements.filter((el) => el.type === "shape" && el.shapeType === "circle").length).toBe(2);
    expect(laidOut.backgroundVariant).toBe("default");
  });

  it("renders quote with muted background", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "金句",
      elements: [
        { id: "q", type: "text", x: 0, y: 0, width: 400, height: 80, text: "心所至 梦必达", fontSize: 32 },
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 40, text: "— 竞聘者", fontSize: 18 },
      ],
    };
    const laidOut = applyLayout(slide, "quote", testSlideStyle(slide));
    const quote = laidOut.elements.find((el) => el.id === "q");
    expect(quote?.type === "text" ? quote.align : undefined).toBe("center");
    expect(laidOut.backgroundVariant).toBe("muted");
  });

  it("places image-grid images into grid slots", () => {
    const imgA = crypto.randomUUID();
    const imgB = crypto.randomUUID();
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "产品图",
      elements: [
        { id: imgA, type: "image", x: 0, y: 0, width: 100, height: 80, url: "a.png", borderRadius: 0 },
        { id: imgB, type: "image", x: 0, y: 0, width: 100, height: 80, url: "b.png", borderRadius: 0 },
      ],
    };
    const laidOut = applyLayout(slide, "image-grid", testSlideStyle(slide));
    const a = laidOut.elements.find((el) => el.type === "image" && el.id === imgA);
    const b = laidOut.elements.find((el) => el.type === "image" && el.id === imgB);
    expect(a?.type === "image" ? a.imageSlot : undefined).toBe("grid-0");
    expect(b?.type === "image" ? b.imageSlot : undefined).toBe("grid-1");
  });
});

describe("layout slots", () => {
  it("resolves case side slot within safe zone", () => {
    const rect = getLayoutSlotRect("case", "side");
    expect(rect).toBeDefined();
    expect(rect!.x).toBeGreaterThanOrEqual(120);
  });

  it("lists slots per layout", () => {
    expect(listLayoutSlots("case")).toEqual(["side"]);
    expect(listLayoutSlots("image-grid")).toContain("grid-0");
  });
});

describe("deck rhythm", () => {
  it("flags three consecutive same layouts", () => {
    const mk = (layout: string) => ({
      id: crypto.randomUUID(),
      title: layout,
      layout,
      elements: [{ id: crypto.randomUUID(), type: "text" as const, x: 140, y: 220, width: 400, height: 80, text: "x", fontSize: 20 }],
    });
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [mk("cover"), mk("concept"), mk("concept"), mk("concept"), mk("summary")],
    };
    const issues = validateDeckRhythm(presentation);
    expect(issues.some((issue) => issue.message.includes("Three consecutive"))).toBe(true);
  });
});

describe("P1 deferred tools", () => {
  it("InsertSlideImage places image in side slot without manual coords", async () => {
    const slideId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [
        {
          id: slideId,
          title: "指标",
          layout: "case",
          elements: [
            { id: crypto.randomUUID(), type: "text", x: 140, y: 220, width: 400, height: 200, text: "说明", fontSize: 20 },
          ],
        },
      ],
    };
    const result = await insertSlideImageTool.execute(
      { slideId, url: "https://example.com/kpi.png", slot: "side" },
      makeContext(presentation),
    );
    expect(result.commands.length).toBe(1);
    expect(result.commands[0]?.type).toBe("add-element");
    if (result.commands[0]?.type === "add-element") {
      expect(result.commands[0].element.type).toBe("image");
      if (result.commands[0].element.type === "image") {
        expect(result.commands[0].element.imageSlot).toBe("side");
        expect(result.commands[0].element.x).toBeGreaterThan(700);
      }
    }
  });

  it("ValidateDeckLayout reports rhythm issues", async () => {
    const mk = (layout: string) => ({
      id: crypto.randomUUID(),
      title: layout,
      layout,
      elements: [],
    });
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [mk("concept"), mk("concept"), mk("concept")],
    };
    const result = await validateDeckLayoutTool.execute({}, makeContext(presentation));
    expect(result.summary.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("PreviewSlide returns structured summary", async () => {
    const slideId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Deck",
      revision: 1,
      designSystem: TEST_DESIGN_SYSTEM,
      slides: [
        {
          id: slideId,
          title: "封面",
          layout: "cover",
          backgroundVariant: "hero",
          elements: [
            { id: crypto.randomUUID(), type: "text", x: 120, y: 200, width: 800, height: 120, text: "标题", fontSize: 56, fontFamily: "serif" },
          ],
        },
      ],
    };
    const result = await previewSlideTool.execute({ slideId, includeThumbnail: false }, makeContext(presentation));
    expect(result.preview?.layout).toBe("cover");
    expect(result.preview?.backgroundVariant).toBe("hero");
    expect(result.preview?.textElements.length).toBe(1);
    expect(result.thumbnail).toBeNull();
  });
});
