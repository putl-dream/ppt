import { describe, expect, it } from "vitest";
import {
  artifactStageToInlineCardType,
  isExportPrompt,
  isPreviewPrompt,
  mergeInlineCardRefs,
  parseInlineCardsFromContent,
  resolveMessageInlineCards,
  shouldShowInlineCard,
} from "../src/shared/inline-artifact-cards";
import { createDefaultBriefMarkdown, createDefaultOutlineMarkdown } from "../src/shared/project-artifacts";
import { createSessionPresentation } from "../src/shared/session";

describe("inline-artifact-cards", () => {
  it("parses artifact references from assistant content", () => {
    expect(parseInlineCardsFromContent("我已更新 brief.md，请确认受众与目的。")).toEqual(["brief"]);
    expect(parseInlineCardsFromContent("这是 outline.md 的章节结构。")).toEqual(["outline"]);
    expect(parseInlineCardsFromContent("演示文稿已生成，可导出 PPT。")).toEqual(["deck"]);
  });

  it("detects export and preview prompts", () => {
    expect(isExportPrompt("请导出 PPT 文件")).toBe(true);
    expect(isPreviewPrompt("打开幻灯片预览")).toBe(true);
    expect(isExportPrompt("继续修改大纲")).toBe(false);
  });

  it("merges inline card refs without duplicates", () => {
    expect(mergeInlineCardRefs([{ type: "brief" }], ["outline", "brief"])).toEqual([
      { type: "brief" },
      { type: "outline" },
    ]);
  });

  it("maps artifact stages to inline card types", () => {
    expect(artifactStageToInlineCardType("brief")).toBe("brief");
    expect(artifactStageToInlineCardType("research")).toBeUndefined();
  });

  it("resolves visible cards from persisted refs and content", () => {
    const presentation = createSessionPresentation("测试项目");
    presentation.revision = 1;
    presentation.slides.push({
      id: "slide-2",
      title: "第二页",
      elements: [],
    });

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
