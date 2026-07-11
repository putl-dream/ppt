import { describe, expect, it } from "vitest";
import {
  applyLayout,
  fitFontSize,
  estimateTextWidthUnits,
} from "../src/shared/layout";
import { resolveColors } from "@design-system";
import { testDesignSystem, testSlideStyle } from "./design-engine-test-utils";
import type { Slide, TextElement } from "../src/shared/presentation";
import { slideSchema } from "../src/shared/presentation";

function textEl(text: string, fontSize = 20): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    text,
    fontSize,
  };
}

function bodyTextsOf(slide: Slide): string {
  return slide.elements
    .filter((el): el is TextElement => el.type === "text")
    .map((el) => el.text)
    .join("\n");
}

describe("fitFontSize", () => {
  it("returns baseSize when short text fits", () => {
    expect(fitFontSize("短", 400, 200, 20)).toBe(20);
  });

  it("steps down for long text in a small box", () => {
    const long = "很长的一段中文文本".repeat(30);
    const size = fitFontSize(long, 200, 60, 20);
    expect(size).toBeLessThan(20);
    expect(size).toBeGreaterThanOrEqual(12);
  });

  it("never returns below minSize", () => {
    const huge = "文字".repeat(500);
    expect(fitFontSize(huge, 100, 40, 20)).toBe(12);
  });

  it("estimates CJK wider than latin", () => {
    expect(estimateTextWidthUnits("中文")).toBeGreaterThan(
      estimateTextWidthUnits("ab"),
    );
  });
});

describe("applyLayout never drops body content", () => {
  it("folds case bodies beyond the metric into the desc column", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "关键案例",
      elements: [
        textEl("案例背景叙述"),
        textEl("76%"),
        textEl("补充要点三"),
        textEl("补充要点四"),
      ],
    };
    const out = applyLayout(slide, "case", testSlideStyle(slide));
    const allText = bodyTextsOf(out);
    expect(allText).toContain("案例背景叙述");
    expect(allText).toContain("补充要点三");
    expect(allText).toContain("补充要点四");
  });

  it("keeps all process steps beyond 4", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "实施流程",
      elements: [
        textEl("第一步"),
        textEl("第二步"),
        textEl("第三步"),
        textEl("第四步"),
        textEl("第五步"),
        textEl("第六步"),
      ],
    };
    const out = applyLayout(slide, "process", testSlideStyle(slide, { palette: "soft-academic" }));
    const allText = bodyTextsOf(out);
    for (const step of ["第一步", "第二步", "第三步", "第四步", "第五步", "第六步"]) {
      expect(allText).toContain(step);
    }
  });

  it("keeps all architecture layers beyond 4", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "系统架构",
      elements: [
        textEl("接入层"),
        textEl("服务层"),
        textEl("数据层"),
        textEl("存储层"),
        textEl("基础设施层"),
      ],
    };
    const out = applyLayout(slide, "architecture", testSlideStyle(slide, { palette: "tech-dark" }));
    const allText = bodyTextsOf(out);
    expect(allText).toContain("基础设施层");
  });

  it("keeps all toc items beyond 8", () => {
    const items = Array.from({ length: 10 }, (_, i) => textEl(`目录项${i + 1}`));
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "目录",
      elements: items,
    };
    const out = applyLayout(slide, "toc", testSlideStyle(slide));
    const allText = bodyTextsOf(out);
    expect(allText).toContain("目录项9");
    expect(allText).toContain("目录项10");
  });

  it("keeps every generated dimension positive for a dense summary", () => {
    const slide: Slide = {
      id: crypto.randomUUID(),
      title: "能力清单",
      elements: Array.from({ length: 7 }, (_, index) => textEl(`能力 ${index + 1}`)),
    };

    const out = applyLayout(slide, "summary", testSlideStyle(slide));

    expect(() => slideSchema.parse(out)).not.toThrow();
    expect(out.elements.every((element) => element.width > 0 && element.height > 0)).toBe(true);
  });
});

describe("design palette participation", () => {
  it("produces distinct accents for every design-engine palette", () => {
    const accents = ["business-blue", "warm-paper", "mono-report", "tech-dark", "soft-academic"].map(
      (palette) => resolveColors(testDesignSystem({ palette: palette as any }).tokens).accent,
    );
    expect(new Set(accents).size).toBe(5);
  });

  it("adapts surfaces for contrast while retaining identity accent", () => {
    const tokens = testDesignSystem({ palette: "warm-paper" }).tokens;
    expect(resolveColors(tokens, "dark").title).toBe("#eff6ff");
    expect(resolveColors(tokens, "dark").accent).toBe("#b45309");
  });
});
