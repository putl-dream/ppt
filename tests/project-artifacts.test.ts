import { describe, expect, it } from "vitest";
import {
  createDefaultBriefMarkdown,
  createDefaultBrandProfile,
  createDefaultProjectDesignSystem,
  createDefaultOutlineMarkdown,
  createDefaultResearchMarkdown,
  parseBriefFields,
  parseBrandProfileFile,
  parseProjectDesignSystem,
  parseOutlineItems,
  parseResearchNotes,
  serializeBriefMarkdown,
  serializeBrandProfile,
  toCommercialCommunicationContract,
  serializeProjectDesignSystem,
  serializeOutlineMarkdown,
} from "../src/shared/project-artifacts";

describe("project artifact canonical formats", () => {
  it("round-trips brief markdown", () => {
    const markdown = createDefaultBriefMarkdown("Q3 汇报");
    const fields = parseBriefFields(markdown);
    expect(fields.title).toBe("Q3 汇报");
    expect(serializeBriefMarkdown(fields)).toContain("**项目名称**: Q3 汇报");
    expect(serializeBriefMarkdown(fields)).toContain("**核心信息**:");
    expect(serializeBriefMarkdown(fields)).toContain("**叙事模式**: executive-brief");
    expect(toCommercialCommunicationContract(fields)).toEqual({
      audience: fields.audience,
      objective: fields.objective,
      desiredAction: fields.desiredAction,
      coreMessage: fields.coreMessage,
      presentationContext: fields.presentationContext,
      afterUse: fields.afterUse,
      restructurePermission: "reorder",
      narrativeMode: "executive-brief",
    });
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
    expect(fields.objective).toBe("争取融资");
    expect(fields.audience).toBe("投资人");
    expect(fields.style).toBe("专业简洁");
  });

  it("normalizes commercial communication aliases in brief markdown", () => {
    const fields = parseBriefFields(`# 演示文稿 Brief

- **项目名称**: 新品发布
- **核心目的**: 获得首批客户
- **目标听众**: 企业采购负责人
- **核心信息**: 产品把部署周期缩短到一周
- **演示场景**: 销售演示
- **期望行动**: 同意启动试点
- **使用方式**: 会后转发给技术团队
- **内容重构**: 允许重写、合并与删减
- **叙事模式**: 问题—方案
- **演讲时长**: 20分钟
- **讲稿配置**: 需要
- **期望风格**: 专业简洁
`);

    expect(fields.restructurePermission).toBe("rewrite-and-merge");
    expect(fields.narrativeMode).toBe("problem-solution");
    expect(fields.desiredAction).toBe("同意启动试点");
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

  it("round-trips a strict brand profile file", () => {
    const profile = createDefaultBrandProfile("Agent PPT");
    const parsed = parseBrandProfileFile(serializeBrandProfile(profile));

    expect(parsed.brandName).toBe("Agent PPT");
    expect(parsed.persona).toBe("consulting");
    expect(parsed.attributes.length).toBeGreaterThanOrEqual(2);
  });
});
