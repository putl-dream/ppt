import {
  DESIGN_PRESETS,
  getVisualStyleDefinition,
  type VisualStyle,
} from "@design-system";
import {
  TEMPLATE_CATALOG_REVISION,
  templateDescriptorSchema,
  type TemplateCapability,
  type TemplateDescriptor,
} from "./template-protocol";

interface BuiltinTemplateSeed {
  id: string;
  visualStyle: VisualStyle;
  name: string;
  description: string;
  topics: string[];
  audiences: string[];
  deliveryContexts: string[];
  density: Array<"calm" | "standard" | "dense">;
  capabilities: TemplateCapability[];
  autoPoolEligible: boolean;
  fallbackEligible: boolean;
  composition: string;
  avoid: string[];
}

/**
 * Auto pool (~7) covers the roadmap scenario set; remaining presets remain
 * selectable via explicit-builtin but do not compete in auto scoring.
 */
const BUILTIN_SEEDS: readonly BuiltinTemplateSeed[] = [
  {
    id: "builtin/swiss-minimal",
    visualStyle: "swiss-minimal",
    name: "商务咨询",
    description: "网格严谨、强留白的高端咨询与决策汇报",
    topics: ["战略", "咨询", "决策", "商业", "管理", "计划"],
    audiences: ["高管", "管理层", "客户", "决策者", "董事会"],
    deliveryContexts: ["现场讲述", "会议", "路演", "汇报"],
    density: ["calm", "standard"],
    capabilities: ["diagram", "chart", "long-text", "table"],
    autoPoolEligible: true,
    fallbackEligible: true,
    composition: "结论先行的清晰网格；大留白；少装饰；强标题层级。",
    avoid: ["满屏卡片墙", "低对比正文", "无意义装饰线"],
  },
  {
    id: "builtin/dark-tech",
    visualStyle: "dark-tech",
    name: "深色科技",
    description: "暗色画布与精确几何，适合产品与架构说明",
    topics: ["产品", "技术", "架构", "工程", "平台", "AI", "软件"],
    audiences: ["工程师", "产品经理", "技术决策者", "研发"],
    deliveryContexts: ["技术评审", "产品发布", "架构讨论"],
    density: ["standard", "dense"],
    capabilities: ["diagram", "chart", "image", "table"],
    autoPoolEligible: true,
    fallbackEligible: false,
    composition: "暗场、精确对齐、发光几何点缀；信息区边界清晰。",
    avoid: ["暖纸杂志感", "手绘质感", "松散拼贴"],
  },
  {
    id: "builtin/blueprint",
    visualStyle: "blueprint",
    name: "工程蓝图",
    description: "工程线稿与技术注释，适合系统设计说明",
    topics: ["架构", "系统", "流程", "工程", "规范", "协议"],
    audiences: ["工程师", "架构师", "实施团队"],
    deliveryContexts: ["技术评审", "培训", "交接"],
    density: ["standard", "dense"],
    capabilities: ["diagram", "table", "long-text"],
    autoPoolEligible: true,
    fallbackEligible: false,
    composition: "线稿网格、注释型标注、模块化分区。",
    avoid: ["摄影主导", "情绪化撞色", "圆角营销风"],
  },
  {
    id: "builtin/data-journalism",
    visualStyle: "data-journalism",
    name: "数据报告",
    description: "出版级数据密度，适合研究、财务与分析报告",
    topics: ["数据", "财务", "研究", "分析", "指标", "市场", "报告"],
    audiences: ["分析师", "投资人", "研究者", "财务"],
    deliveryContexts: ["异步近读", "报告", "评审会"],
    density: ["dense", "standard"],
    capabilities: ["chart", "table", "long-text", "diagram"],
    autoPoolEligible: true,
    fallbackEligible: false,
    composition: "高信息密度、来源线、微图表与栏目化排版。",
    avoid: ["舞台式极简空页", "缺数据的装饰图", "过大留白浪费"],
  },
  {
    id: "builtin/soft-rounded",
    visualStyle: "soft-rounded",
    name: "培训教学",
    description: "友好圆角与克制柔影，适合课程与培训",
    topics: ["培训", "教育", "课程", "教程", "学习", "入职"],
    audiences: ["学员", "新员工", "教师", "团队"],
    deliveryContexts: ["培训", "课堂", "工作坊"],
    density: ["calm", "standard"],
    capabilities: ["diagram", "image", "long-text", "table"],
    autoPoolEligible: true,
    fallbackEligible: false,
    composition: "分步说明、友好容器、清晰示例区与练习节奏。",
    avoid: ["高压撞色", "报纸高密度", "暗场科技风"],
  },
  {
    id: "builtin/glassmorphism",
    visualStyle: "glassmorphism",
    name: "品牌发布",
    description: "暗场玻璃与漂浮层级，适合发布与营销叙事",
    topics: ["品牌", "发布", "营销", "活动", "发布会", "新品"],
    audiences: ["客户", "媒体", "市场", "用户"],
    deliveryContexts: ["发布会", "现场讲述", "路演"],
    density: ["calm", "standard"],
    capabilities: ["image", "diagram", "chart"],
    autoPoolEligible: true,
    fallbackEligible: false,
    composition: "大视觉焦点、情绪节奏、少正文多冲击。",
    avoid: ["密表长文", "公文简报感", "缺图时的空玻璃框"],
  },
  {
    id: "builtin/editorial",
    visualStyle: "editorial",
    name: "编辑出版",
    description: "杂志栏目与字体对照，适合文化、历史与编辑叙事",
    topics: ["文化", "历史", "出版", "媒体", "故事", "评论"],
    audiences: ["读者", "编辑", "公众", "客户"],
    deliveryContexts: ["异步近读", "分享会", "展览"],
    density: ["standard", "dense"],
    capabilities: ["image", "long-text", "diagram"],
    autoPoolEligible: true,
    fallbackEligible: false,
    composition: "栏目网格、细规则线、标题与正文字体角色对照。",
    avoid: ["游戏像素风", "玻璃拟态营销壳", "全页卡片重复"],
  },
];

const AUTO_POOL_IDS = new Set(BUILTIN_SEEDS.map((seed) => seed.id));

function seedToDescriptor(seed: BuiltinTemplateSeed): TemplateDescriptor {
  const preset = DESIGN_PRESETS.find((item) => item.id === seed.visualStyle);
  if (!preset) {
    throw new Error(`Missing design preset for ${seed.visualStyle}`);
  }
  const style = getVisualStyleDefinition(seed.visualStyle);
  return templateDescriptorSchema.parse({
    id: seed.id,
    revisionId: TEMPLATE_CATALOG_REVISION,
    kind: "builtin",
    supportLevel: "native",
    name: seed.name,
    description: seed.description,
    designSystem: preset.system,
    matching: {
      topics: seed.topics,
      audiences: seed.audiences,
      deliveryContexts: seed.deliveryContexts,
      argumentModes: [preset.system.argumentMode],
      readingModes: [preset.system.readingMode],
      density: seed.density,
      capabilities: seed.capabilities,
    },
    authoringGuidance: {
      composition: seed.composition || style.summary,
      avoid: seed.avoid.length > 0
        ? seed.avoid
        : [...style.grammarPreferences.avoid],
    },
    autoPoolEligible: seed.autoPoolEligible,
    fallbackEligible: seed.fallbackEligible,
  });
}

function presetToExplicitDescriptor(
  visualStyle: VisualStyle,
): TemplateDescriptor {
  const preset = DESIGN_PRESETS.find((item) => item.id === visualStyle);
  if (!preset) {
    throw new Error(`Missing design preset for ${visualStyle}`);
  }
  const style = getVisualStyleDefinition(visualStyle);
  const id = `builtin/${visualStyle}`;
  const seeded = BUILTIN_SEEDS.find((item) => item.visualStyle === visualStyle);
  if (seeded) return seedToDescriptor(seeded);
  return templateDescriptorSchema.parse({
    id,
    revisionId: TEMPLATE_CATALOG_REVISION,
    kind: "builtin",
    supportLevel: "native",
    name: preset.label,
    description: preset.description,
    designSystem: preset.system,
    matching: {
      topics: [...style.bestFor].slice(0, 8),
      audiences: ["通用受众"],
      deliveryContexts: ["会议", "异步近读"],
      argumentModes: [preset.system.argumentMode],
      readingModes: [preset.system.readingMode],
      density: ["standard"],
      capabilities: ["diagram", "long-text", "image", "chart", "table"],
    },
    authoringGuidance: {
      composition: style.summary,
      avoid: [...style.grammarPreferences.avoid],
    },
    autoPoolEligible: false,
    fallbackEligible: false,
  });
}

const BUILTIN_BY_ID = new Map<string, TemplateDescriptor>();

for (const preset of DESIGN_PRESETS) {
  const descriptor = presetToExplicitDescriptor(preset.id);
  BUILTIN_BY_ID.set(descriptor.id, descriptor);
}

for (const seed of BUILTIN_SEEDS) {
  BUILTIN_BY_ID.set(seed.id, seedToDescriptor(seed));
}

export const BUILTIN_TEMPLATE_CATALOG: readonly TemplateDescriptor[] = Object.freeze(
  [...BUILTIN_BY_ID.values()].sort((left, right) => left.id.localeCompare(right.id)),
);

export function listBuiltinTemplates(): readonly TemplateDescriptor[] {
  return BUILTIN_TEMPLATE_CATALOG;
}

export function listAutoPoolTemplates(): readonly TemplateDescriptor[] {
  return BUILTIN_TEMPLATE_CATALOG.filter((item) => item.autoPoolEligible);
}

export function getBuiltinTemplate(id: string): TemplateDescriptor | undefined {
  return BUILTIN_BY_ID.get(id);
}

export function getBuiltinTemplateByVisualStyle(
  visualStyle: VisualStyle,
): TemplateDescriptor | undefined {
  return BUILTIN_BY_ID.get(`builtin/${visualStyle}`);
}

export function isAutoPoolTemplateId(id: string): boolean {
  return AUTO_POOL_IDS.has(id);
}

export function requireBuiltinTemplate(id: string): TemplateDescriptor {
  const found = getBuiltinTemplate(id);
  if (!found) {
    throw new Error(`Unknown builtin template: ${id}`);
  }
  return found;
}
