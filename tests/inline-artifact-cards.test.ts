import { describe, expect, it } from "vitest";
import {
  artifactStageToInlineCardType,
  isPreviewPrompt,
  mergeInlineCardRefs,
  parseInlineCardsFromContent,
  resolveMessageInlineCards,
  shouldShowInlineCard,
} from "../src/shared/inline-artifact-cards";
import { applyLayout } from "../src/shared/layout";
import { createDefaultBriefMarkdown, createDefaultOutlineMarkdown } from "../src/shared/project-artifacts";
import { createSessionPresentation } from "../src/shared/session";

describe("inline-artifact-cards", () => {
  it("parses artifact references from assistant content", () => {
    expect(parseInlineCardsFromContent("我已更新 brief.md，请确认受众与目的。")).toEqual(["brief"]);
    expect(parseInlineCardsFromContent("这是 outline.md 的章节结构。")).toEqual(["outline"]);
    expect(parseInlineCardsFromContent("内容草稿已就绪，请选择排版方式。")).toEqual(["layout"]);
    expect(parseInlineCardsFromContent("演示文稿已生成，可导出 PPT。")).toEqual(["deck"]);
  });

  it("does not create deck cards for export result messages", () => {
    expect(parseInlineCardsFromContent("演示文稿已导出至：C:\\Users\\me\\Documents\\deck.pptx")).toEqual([]);
    expect(parseInlineCardsFromContent("导出失败：文件被占用")).toEqual([]);
    expect(parseInlineCardsFromContent("文件已保存。 [打开所在目录](#open-export-folder=C%3A%5Cdeck.pptx)")).toEqual([]);
  });

  it("detects preview prompts", () => {
    expect(isPreviewPrompt("打开幻灯片预览")).toBe(true);
    expect(isPreviewPrompt("继续修改大纲")).toBe(false);
  });

  it("merges inline card refs without duplicates", () => {
    expect(mergeInlineCardRefs([{ type: "brief" }], ["outline", "brief"])).toEqual([
      { type: "brief" },
      { type: "outline" },
    ]);
    expect(mergeInlineCardRefs(undefined, ["layout"])).toEqual([{ type: "layout" }]);
  });

  it("maps artifact stages to inline card types", () => {
    expect(artifactStageToInlineCardType("brief")).toBe("brief");
    expect(artifactStageToInlineCardType("research")).toBeUndefined();
  });

  it("resolves visible cards from persisted refs and content", () => {
    const presentation = createSessionPresentation("测试项目");
    presentation.revision = 1;
    const secondSlide = {
      id: "slide-2",
      title: "第二页",
      layout: "summary" as const,
      elements: [
        {
          id: "point-1",
          type: "text" as const,
          x: 0,
          y: 0,
          width: 200,
          height: 40,
          text: "要点",
          fontSize: 20,
        },
      ],
    };
    const laidOutSlide = applyLayout(secondSlide, "summary", "ocean", "cyan");
    presentation.slides = [laidOutSlide];
    presentation.revision = 1;

    const refs = resolveMessageInlineCards(
      "请查看 outline.md",
      [{ type: "outline" }, { type: "deck" }],
      {
        briefContent: createDefaultBriefMarkdown(),
        outlineContent: "# 演示大纲\n\n## 1. 行业背景 [预计 1 页]\n- 趋势",
        presentation,
      },
    );

    expect(refs.map((card) => card.type)).toEqual(["outline", "deck"]);
    expect(shouldShowInlineCard("outline", {
      outlineContent: "# 演示大纲\n\n## 1. 行业背景 [预计 1 页]\n- 趋势",
    })).toBe(true);
    expect(shouldShowInlineCard("outline", {
      outlineContent: createDefaultOutlineMarkdown(),
    })).toBe(false);
  });
});
