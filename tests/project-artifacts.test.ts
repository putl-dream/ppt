import { describe, expect, it } from "vitest";
import {
  createDefaultBriefMarkdown,
  createDefaultProjectDesignSystem,
  createDefaultOutlineMarkdown,
  createDefaultResearchMarkdown,
  parseBriefFields,
  parseProjectDesignSystem,
  parseOutlineItems,
  parseResearchNotes,
  serializeBriefMarkdown,
  serializeProjectDesignSystem,
  serializeOutlineMarkdown,
} from "../src/shared/project-artifacts";

describe("project artifact canonical formats", () => {
  it("round-trips brief markdown", () => {
    const markdown = createDefaultBriefMarkdown("Q3 汇报");
    const fields = parseBriefFields(markdown);
    expect(fields.title).toBe("Q3 汇报");
    expect(serializeBriefMarkdown(fields)).toContain("**项目名称**: Q3 汇报");
  });

  it("parses legacy brief section markdown", () => {
    const legacy = `# Brief: 路演稿

## 目的
- 争取融资

## 受众
- 投资人

## 方向
- 专业简洁
`;
    const fields = parseBriefFields(legacy);
    expect(fields.title).toBe("路演稿");
    expect(fields.purpose).toBe("争取融资");
    expect(fields.audience).toBe("投资人");
    expect(fields.style).toBe("专业简洁");
  });

  it("round-trips outline markdown and parses legacy outline", () => {
    const canonical = createDefaultOutlineMarkdown();
    const items = parseOutlineItems(canonical);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(serializeOutlineMarkdown(items)).toContain("## 1.");

    const legacy = `# Outline: Demo

## 核心观点
- one

## 章节结构
1. 开场与背景
2. 方案论证

## 待确认问题
- none
`;
    const legacyItems = parseOutlineItems(legacy);
    expect(legacyItems.map((item) => item.title)).toEqual(["开场与背景", "方案论证"]);
  });

  it("round-trips research notes and parses legacy sections", () => {
    const canonical = createDefaultResearchMarkdown();
    const notes = parseResearchNotes(canonical);
    expect(notes.length).toBeGreaterThan(0);

    const legacy = `# Research Notes

## 事实
- 市场增长 12%

## 观点
- 需求强劲
`;
    const legacyNotes = parseResearchNotes(legacy);
    expect(legacyNotes.some((note) => note.quote.includes("市场增长"))).toBe(true);
    expect(legacyNotes.some((note) => note.quote.includes("需求强劲"))).toBe(true);
  });

  it("round-trips strict DesignSystemV1 JSON", () => {
    const system = createDefaultProjectDesignSystem();
    const serialized = parseProjectDesignSystem(serializeProjectDesignSystem(system));
    expect(serialized).toEqual(system);
  });

  it("rejects old theme/palette project design files", () => {
    expect(() => parseProjectDesignSystem(JSON.stringify({ theme: "nordic", palette: "cyan" }))).toThrow();
  });
});
