/**
 * Canonical parsers / serializers for project sandbox artifact files.
 * Shared by Main (templates), Renderer (editors), and Agent context helpers.
 */
import {
  DEFAULT_DESIGN_SYSTEM,
  designSystemV1Schema,
  type DesignSystemV1,
  DEFAULT_BRAND_PROFILE,
  brandProfileV1Schema,
  type BrandProfileV1,
} from "@design-system";
import {
  COMMERCIAL_COMMUNICATION_DEFAULTS,
  normalizeNarrativeMode,
  normalizeRestructurePermission,
  type CommercialCommunicationContract,
} from "./commercial-communication";

export interface BriefFields extends CommercialCommunicationContract {
  title: string;
  /** @deprecated Read objective instead; retained for legacy callers. */
  purpose: string;
  duration: string;
  script: string;
  style: string;
}

export interface OutlineItem {
  id: string;
  title: string;
  pages: number;
  points: string[];
}

export interface ResearchNote {
  id: string;
  source: string;
  quote: string;
}

const DEFAULT_BRIEF_FIELDS: BriefFields = {
  title: "新演示文稿",
  purpose: "汇报",
  objective: "汇报",
  audience: "团队成员",
  desiredAction: "理解结论并确认下一步",
  ...COMMERCIAL_COMMUNICATION_DEFAULTS,
  duration: "20分钟",
  script: "需要",
  style: "专业简洁",
};

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultBriefMarkdown(title = DEFAULT_BRIEF_FIELDS.title): string {
  return serializeBriefMarkdown({ ...DEFAULT_BRIEF_FIELDS, title });
}

export function isDefaultBriefMarkdown(md: string): boolean {
  const fields = parseBriefFields(md, DEFAULT_BRIEF_FIELDS.title);
  const hasDefaultFields = fields.objective === DEFAULT_BRIEF_FIELDS.objective
    && fields.audience === DEFAULT_BRIEF_FIELDS.audience
    && fields.desiredAction === DEFAULT_BRIEF_FIELDS.desiredAction
    && fields.coreMessage === DEFAULT_BRIEF_FIELDS.coreMessage
    && fields.presentationContext === DEFAULT_BRIEF_FIELDS.presentationContext
    && fields.afterUse === DEFAULT_BRIEF_FIELDS.afterUse
    && fields.restructurePermission === DEFAULT_BRIEF_FIELDS.restructurePermission
    && fields.narrativeMode === DEFAULT_BRIEF_FIELDS.narrativeMode
    && fields.duration === DEFAULT_BRIEF_FIELDS.duration
    && fields.script === DEFAULT_BRIEF_FIELDS.script
    && fields.style === DEFAULT_BRIEF_FIELDS.style;
  return hasDefaultFields
    && normalizeMarkdownForComparison(md) === normalizeMarkdownForComparison(createDefaultBriefMarkdown(fields.title));
}

export function parseBriefFields(md: string, fallbackTitle = DEFAULT_BRIEF_FIELDS.title): BriefFields {
  const fields: BriefFields = { ...DEFAULT_BRIEF_FIELDS, title: fallbackTitle };

  type BriefTextKey = Exclude<keyof BriefFields, "restructurePermission" | "narrativeMode">;
  const formPatterns: Array<[BriefTextKey, RegExp]> = [
    ["title", /-\s+\*\*项目名称\*\*:\s*(.*)/],
    ["objective", /-\s+\*\*核心目的\*\*:\s*(.*)/],
    ["audience", /-\s+\*\*目标听众\*\*:\s*(.*)/],
    ["coreMessage", /-\s+\*\*核心信息\*\*:\s*(.*)/],
    ["presentationContext", /-\s+\*\*演示场景\*\*:\s*(.*)/],
    ["desiredAction", /-\s+\*\*期望行动\*\*:\s*(.*)/],
    ["afterUse", /-\s+\*\*使用方式\*\*:\s*(.*)/],
    ["duration", /-\s+\*\*演讲时长\*\*:\s*(.*)/],
    ["script", /-\s+\*\*讲稿配置\*\*:\s*(.*)/],
    ["style", /-\s+\*\*期望风格\*\*:\s*(.*)/],
  ];

  for (const [key, pattern] of formPatterns) {
    const match = md.match(pattern);
    if (match?.[1]?.trim()) fields[key] = match[1].trim();
  }
  const restructureMatch = md.match(/-\s+\*\*内容重构\*\*:\s*(.*)/);
  if (restructureMatch?.[1]?.trim()) {
    fields.restructurePermission = normalizeRestructurePermission(restructureMatch[1]);
  }
  const narrativeMatch = md.match(/-\s+\*\*叙事模式\*\*:\s*(.*)/);
  if (narrativeMatch?.[1]?.trim()) {
    fields.narrativeMode = normalizeNarrativeMode(narrativeMatch[1]);
  }

  const sectionPatterns: Array<[BriefTextKey, RegExp]> = [
    ["objective", /##\s*目的\s*\n([\s\S]*?)(?=\n##|\n$)/i],
    ["audience", /##\s*受众\s*\n([\s\S]*?)(?=\n##|\n$)/i],
    ["style", /##\s*方向\s*\n([\s\S]*?)(?=\n##|\n$)/i],
  ];

  for (const [key, pattern] of sectionPatterns) {
    if (fields[key] !== DEFAULT_BRIEF_FIELDS[key] && key !== "title") continue;
    const match = md.match(pattern);
    if (!match?.[1]) continue;
    const line = match[1]
      .split("\n")
      .map((item) => item.replace(/^-\s*/, "").trim())
      .find(Boolean);
    if (line) fields[key] = line.slice(0, 200);
  }

  const titleMatch = md.match(/^#\s*(?:Brief:\s*|演示文稿 Brief\s*)?(.+)$/m);
  if (titleMatch?.[1]?.trim() && fields.title === fallbackTitle) {
    fields.title = titleMatch[1].trim();
  }

  fields.purpose = fields.objective;
  fields.restructurePermission = normalizeRestructurePermission(fields.restructurePermission);
  fields.narrativeMode = normalizeNarrativeMode(fields.narrativeMode);

  return fields;
}

export function serializeBriefMarkdown(fields: BriefFields): string {
  return `# 演示文稿 Brief

- **项目名称**: ${fields.title}
- **核心目的**: ${fields.objective}
- **目标听众**: ${fields.audience}
- **核心信息**: ${fields.coreMessage}
- **演示场景**: ${fields.presentationContext}
- **期望行动**: ${fields.desiredAction}
- **使用方式**: ${fields.afterUse}
- **内容重构**: ${fields.restructurePermission}
- **叙事模式**: ${fields.narrativeMode}
- **演讲时长**: ${fields.duration}
- **讲稿配置**: ${fields.script}
- **期望风格**: ${fields.style}
`;
}

export function toCommercialCommunicationContract(
  fields: BriefFields,
): CommercialCommunicationContract {
  return {
    audience: fields.audience,
    objective: fields.objective,
    desiredAction: fields.desiredAction,
    coreMessage: fields.coreMessage,
    presentationContext: fields.presentationContext,
    afterUse: fields.afterUse,
    restructurePermission: fields.restructurePermission,
    narrativeMode: fields.narrativeMode,
  };
}

export function createDefaultOutlineMarkdown(title = "新演示文稿"): string {
  return serializeOutlineMarkdown([
    {
      id: createId("outline"),
      title: "行业背景与痛点",
      pages: 1,
      points: ["行业增速放缓", "痛点分析"],
    },
    {
      id: createId("outline"),
      title: "解决方案",
      pages: 1,
      points: ["产品定位", "核心竞争力"],
    },
    {
      id: createId("outline"),
      title: "发展规划",
      pages: 1,
      points: ["下一步里程碑", "商业价值"],
    },
  ], title);
}

export function isDefaultOutlineMarkdown(md: string): boolean {
  return normalizeMarkdownForComparison(md) === normalizeMarkdownForComparison(createDefaultOutlineMarkdown());
}

function normalizeMarkdownForComparison(md: string): string {
  return md.replace(/\r\n/g, "\n").trim();
}

const OUTLINE_META_SECTIONS = new Set(["核心观点", "章节结构", "待确认问题"]);

export function parseOutlineItems(md: string): OutlineItem[] {
  const frontendItems = parseFrontendOutlineItems(md);
  if (frontendItems.length > 0) return frontendItems;

  const legacyItems = parseLegacyOutlineItems(md);
  if (legacyItems.length > 0) return legacyItems;

  return [
    {
      id: createId("outline"),
      title: "行业背景与痛点",
      pages: 1,
      points: ["痛点一", "痛点二"],
    },
  ];
}

function parseFrontendOutlineItems(md: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = md.split("\n");
  let currentItem: OutlineItem | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+\d+\.\s*(.*?)\s*(?:\[预计\s*(\d+)\s*页\])?\s*$/);
    if (headerMatch) {
      if (currentItem) items.push(currentItem);
      currentItem = {
        id: createId("outline"),
        title: headerMatch[1].trim(),
        pages: headerMatch[2] ? Number.parseInt(headerMatch[2], 10) : 1,
        points: [],
      };
      continue;
    }

    const pointMatch = line.match(/^[-*]\s*(.*)$/);
    if (pointMatch && currentItem) {
      currentItem.points.push(pointMatch[1].trim());
    }
  }

  if (currentItem) items.push(currentItem);
  return items;
}

function parseLegacyOutlineItems(md: string): OutlineItem[] {
  const sectionMatch = md.match(/##\s*章节结构\s*\n([\s\S]*?)(?=\n##|\n$)/i);
  if (sectionMatch?.[1]) {
    const items: OutlineItem[] = [];
    for (const line of sectionMatch[1].split("\n")) {
      const numbered = line.match(/^\d+\.\s+(.+)$/);
      if (!numbered?.[1]?.trim()) continue;
      items.push({
        id: createId("outline"),
        title: numbered[1].trim(),
        pages: 1,
        points: [],
      });
    }
    if (items.length > 0) return items;
  }

  const items: OutlineItem[] = [];
  const lines = md.split("\n");
  let currentItem: OutlineItem | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch?.[1]) {
      const title = headingMatch[1].replace(/^\d+\.\s*/, "").trim();
      if (OUTLINE_META_SECTIONS.has(title) || /^outline:/i.test(title)) {
        currentItem = null;
        continue;
      }
      if (currentItem) items.push(currentItem);
      currentItem = {
        id: createId("outline"),
        title,
        pages: 1,
        points: [],
      };
      continue;
    }

    const pointMatch = line.match(/^[-*]\s*(.*)$/);
    if (pointMatch && currentItem) {
      currentItem.points.push(pointMatch[1].trim());
    }
  }

  if (currentItem) items.push(currentItem);
  return items;
}

export function serializeOutlineMarkdown(items: OutlineItem[], _title = "演示大纲"): string {
  const body = items
    .map((item, index) => {
      const head = `## ${index + 1}. ${item.title} [预计 ${item.pages} 页]`;
      const points = item.points.map((point) => `- ${point}`).join("\n");
      return `${head}\n${points}`;
    })
    .join("\n\n");

  return `# 演示大纲\n\n${body}\n`;
}

export function createDefaultResearchMarkdown(): string {
  return serializeResearchNotes([
    {
      id: createId("research"),
      source: "行业数据",
      quote: "2026年市场增长率约为12%。",
    },
    {
      id: createId("research"),
      source: "竞品分析",
      quote: "A产品优势在价格，B产品优势在服务。",
    },
  ]);
}

export function parseResearchNotes(md: string): ResearchNote[] {
  const formNotes: ResearchNote[] = [];
  for (const line of md.split("\n")) {
    const sourceMatch = line.match(/^-\s+\*\*(.*?)\*\*:\s*(.*)$/);
    if (!sourceMatch) continue;
    formNotes.push({
      id: createId("research"),
      source: sourceMatch[1].trim(),
      quote: sourceMatch[2].trim(),
    });
  }
  if (formNotes.length > 0) return formNotes;

  const legacyNotes: ResearchNote[] = [];
  const sectionPatterns = [
    /##\s*事实\s*\n([\s\S]*?)(?=\n##|\n$)/i,
    /##\s*观点\s*\n([\s\S]*?)(?=\n##|\n$)/i,
    /##\s*可用素材\s*\n([\s\S]*?)(?=\n##|\n$)/i,
  ];

  for (const pattern of sectionPatterns) {
    const match = md.match(pattern);
    if (!match?.[1]) continue;
    const sectionName = match[0].match(/##\s*(\S+)/)?.[1] ?? "研究摘录";
    for (const line of match[1].split("\n")) {
      const bullet = line.match(/^[-*]\s*(.*)$/);
      if (!bullet?.[1]?.trim()) continue;
      legacyNotes.push({
        id: createId("research"),
        source: sectionName,
        quote: bullet[1].trim(),
      });
    }
  }

  if (legacyNotes.length > 0) return legacyNotes;

  return [
    {
      id: createId("research"),
      source: "行业背景数据",
      quote: "2026年全球智能硬件出货量增长预计达到15%。",
    },
  ];
}

export function serializeResearchNotes(notes: ResearchNote[]): string {
  const body = notes.map((note) => `- **${note.source}**: ${note.quote}`).join("\n");
  return `# 研究资料与素材\n\n${body}\n`;
}

export function createDefaultProjectDesignSystem(): DesignSystemV1 {
  return structuredClone(DEFAULT_DESIGN_SYSTEM);
}

export function parseProjectDesignSystem(content: string): DesignSystemV1 {
  return designSystemV1Schema.parse(JSON.parse(content));
}

export function serializeProjectDesignSystem(system: DesignSystemV1): string {
  return `${JSON.stringify(designSystemV1Schema.parse(system), null, 2)}\n`;
}

export function createDefaultBrandProfile(brandName = "未命名品牌"): BrandProfileV1 {
  return brandProfileV1Schema.parse({ ...DEFAULT_BRAND_PROFILE, brandName });
}

export function parseBrandProfileFile(content: string): BrandProfileV1 {
  return brandProfileV1Schema.parse(JSON.parse(content));
}

export function serializeBrandProfile(profile: BrandProfileV1): string {
  return `${JSON.stringify(brandProfileV1Schema.parse(profile), null, 2)}\n`;
}
