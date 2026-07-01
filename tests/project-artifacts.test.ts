import { describe, expect, it } from "vitest";
import {
  createDefaultBriefMarkdown,
  createDefaultDesignTheme,
  createDefaultOutlineMarkdown,
  createDefaultResearchMarkdown,
  normalizeDesignTheme,
  parseBriefFields,
  parseDesignTheme,
  parseOutlineItems,
  parseResearchNotes,
  serializeBriefMarkdown,
  serializeDesignTheme,
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

  it("normalizes legacy design theme json for renderer and agent", () => {
    const legacy = {
      tone: "professional",
      typography: { heading: "serif", body: "sans" },
      palette: {
        primary: "#2563eb",
        accent: "#10b981",
        background: "#f8fafc",
        text: "#111827",
      },
      layout: { ratio: "16:9", density: "balanced" },
    };

    const normalized = normalizeDesignTheme(legacy);
    expect(normalized.theme).toBe("nordic");
    expect(normalized.palette).toBe("cyan");
    expect(normalized.ratio).toBe("16:9");
    expect(normalized.tone).toBe("professional");
    expect(normalized.colors.primary).toBe("#2563eb");

    const serialized = parseDesignTheme(serializeDesignTheme(normalized));
    expect(serialized.theme).toBe(normalized.theme);
    expect(serialized.palette).toBe(normalized.palette);
    expect(serialized.logoUrl).toBeNull();
  });

  it("creates default design theme with ui fields", () => {
    const theme = createDefaultDesignTheme();
    expect(theme.theme).toBe("nordic");
    expect(theme.palette).toBe("cyan");
    expect(theme.layout.ratio).toBe("16:9");
  });
});
