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
});
