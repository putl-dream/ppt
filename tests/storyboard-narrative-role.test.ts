import { describe, expect, it } from "vitest";
import {
  NARRATIVE_ROLE_DEFAULT_LAYOUT,
  normalizeStoryboardSlide,
  parseStoryboard,
  resolveStoryboardLayout,
} from "../src/shared/storyboard";

describe("storyboard narrativeRole (P1-2)", () => {
  it("derives layout from narrativeRole when layout is omitted", () => {
    const slide = normalizeStoryboardSlide({
      title: "核心观点",
      narrativeRole: "core",
      keyPoints: ["要点一", "要点二"],
    }, 0);

    expect(slide.narrativeRole).toBe("core");
    expect(slide.layout).toBe("concept");
    expect(resolveStoryboardLayout(slide)).toBe("concept");
  });

  it("accepts legacy bulletPoints alias", () => {
    const slide = normalizeStoryboardSlide({
      title: "封面",
      narrativeRole: "hook",
      bulletPoints: ["副标题"],
    }, 0);

    expect(slide.keyPoints).toEqual(["副标题"]);
    expect(slide.layout).toBe("cover");
  });

  it("explicit layout overrides narrativeRole default", () => {
    const slide = normalizeStoryboardSlide({
      title: "特殊页",
      narrativeRole: "core",
      layout: "quote",
      keyPoints: ["金句"],
    }, 1);

    expect(resolveStoryboardLayout(slide)).toBe("quote");
  });

  it("parses a storyboard array with narrative roles", () => {
    const json = JSON.stringify([
      { title: "开场", narrativeRole: "hook", keyPoints: [] },
      { title: "对比", narrativeRole: "compare", keyPoints: ["A", "B"] },
    ]);
    const slides = parseStoryboard(json);
    expect(slides[0].layout).toBe(NARRATIVE_ROLE_DEFAULT_LAYOUT.hook);
    expect(slides[1].layout).toBe("comparison");
  });

  it("accepts a slides wrapper and slideId aliases from generated storyboard files", () => {
    const json = JSON.stringify({
      slides: [
        {
          slideId: "slide-cover",
          title: "PPT 智能助手",
          narrativeRole: "hook",
          layout: "cover",
          keyPoints: ["展示从一句话到完整演示的生成路径。"],
        },
      ],
    });

    const slides = parseStoryboard(json);
    expect(slides).toHaveLength(1);
    expect(slides[0].id).toBe("slide-cover");
    expect(slides[0].layout).toBe("cover");
  });

  it("normalizes common narrative arc aliases produced by planning agents", () => {
    const json = JSON.stringify([
      { title: "背景", narrativeRole: "context", keyPoints: ["建立用户痛点。"] },
      { title: "转折", narrativeRole: "shift", keyPoints: ["从功能转向价值。"] },
      { title: "结论", narrativeRole: "takeaway", keyPoints: ["收束核心价值。"] },
    ]);

    const slides = parseStoryboard(json);
    expect(slides.map((slide) => slide.narrativeRole)).toEqual(["core", "core", "summary"]);
    expect(slides.map((slide) => slide.layout)).toEqual(["concept", "concept", "summary"]);
  });
});
