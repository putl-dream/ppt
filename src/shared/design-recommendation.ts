import {
  designSystemV2Schema,
  getVisualStyleDefinition,
  selectDesignPreset,
  VISUAL_STYLE_CATALOG,
  type ArgumentMode,
  type ColorScheme,
  type DesignSystemV2,
  type ReadingMode,
  type VisualStyle,
} from "@design-system";
import {
  designPlanCandidateSchema,
  type CommunicationContract,
  type DesignDirection,
  type DesignPlanCandidate,
} from "./design-plan";

export interface ResolveDesignPlanInput {
  communicationContract: CommunicationContract;
  sourceText?: string;
  argumentMode?: ArgumentMode;
  readingMode?: ReadingMode;
  colorScheme?: ColorScheme;
  visualStyle?: VisualStyle;
}

const STYLE_ALIASES: ReadonlyArray<readonly [RegExp, VisualStyle]> = [
  [/(瑞士|swiss|极简|minimal)/i, "swiss-minimal"],
  [/(圆角|柔和|soft.?rounded)/i, "soft-rounded"],
  [/(玻璃|glass)/i, "glassmorphism"],
  [/(深色科技|暗色科技|dark.?tech)/i, "dark-tech"],
  [/(蓝图|blueprint)/i, "blueprint"],
  [/(摄影编辑|photo.?editorial)/i, "photo-editorial"],
  [/(数据新闻|data.?journalism)/i, "data-journalism"],
  [/(粗野|brutalist)/i, "brutalist"],
  [/(孟菲斯|memphis)/i, "memphis"],
  [/(小刊|zine|riso)/i, "zine"],
  [/(复古海报|vintage.?poster)/i, "vintage-poster"],
  [/(剪纸|paper.?cut)/i, "paper-cut"],
  [/(手绘笔记|sketch.?notes)/i, "sketch-notes"],
  [/(墨迹笔记|ink.?notes)/i, "ink-notes"],
  [/(黑板|chalkboard)/i, "chalkboard"],
  [/(水墨|ink.?wash)/i, "ink-wash"],
  [/(像素|pixel.?art)/i, "pixel-art"],
  [/(编辑出版|editorial)/i, "editorial"],
];

export function matchVisualStyleFromText(text: string): VisualStyle | undefined {
  const normalized = text.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  const direct = VISUAL_STYLE_CATALOG.find((style) =>
    normalized.includes(style.id) || normalized.includes(style.label.toLocaleLowerCase())
  );
  if (direct) return direct.id;
  return STYLE_ALIASES.find(([pattern]) => pattern.test(text))?.[1];
}

interface SpectrumProfile {
  signals: readonly string[];
  styles: readonly [VisualStyle, VisualStyle, VisualStyle];
  recommendedTier: "safe" | "shifted" | "bold";
  reason: string;
}

const SPECTRUM_PROFILES: readonly SpectrumProfile[] = [
  {
    signals: ["游戏", "game", "gaming", "电竞", "retro"],
    styles: ["dark-tech", "pixel-art", "memphis"],
    recommendedTier: "shifted",
    reason: "游戏与复古科技主题需要清晰产品骨架，同时允许可识别的像素语言。",
  },
  {
    signals: ["教育", "培训", "课程", "教学", "课堂", "education", "training", "course"],
    styles: ["soft-rounded", "sketch-notes", "chalkboard"],
    recommendedTier: "shifted",
    reason: "教学主题优先可理解性，再逐步增加手绘记忆点和课堂氛围。",
  },
  {
    signals: ["文化", "传统", "历史", "传承", "国风", "culture", "heritage", "history"],
    styles: ["editorial", "vintage-poster", "ink-wash"],
    recommendedTier: "shifted",
    reason: "文化主题适合从出版秩序过渡到具有时代或水墨辨识度的表达。",
  },
  {
    signals: ["品牌", "发布", "营销", "故事", "消费", "brand", "launch", "marketing", "story"],
    styles: ["editorial", "photo-editorial", "memphis"],
    recommendedTier: "shifted",
    reason: "品牌叙事需要编辑层级、摄影情绪与更具能量的发布选项。",
  },
  {
    signals: ["财务", "经营", "数据", "投资", "研究", "finance", "financial", "data", "investor", "research"],
    styles: ["swiss-minimal", "data-journalism", "brutalist"],
    recommendedTier: "shifted",
    reason: "证据密集主题先保证网格可信度，再提升数据出版感与观点张力。",
  },
  {
    signals: ["技术", "研发", "架构", "工程", "人工智能", "开发者", "ai", "technical", "engineering", "architecture", "developer"],
    styles: ["swiss-minimal", "blueprint", "dark-tech"],
    recommendedTier: "shifted",
    reason: "技术主题应同时提供决策级秩序、工程注释能力与高能暗场表达。",
  },
];

const DEFAULT_PROFILE: SpectrumProfile = {
  signals: [],
  styles: ["swiss-minimal", "editorial", "brutalist"],
  recommendedTier: "shifted",
  reason: "在未知品牌约束下，以克制网格、编辑层级和强观点表达形成清晰光谱。",
};

function normalizedSource(input: ResolveDesignPlanInput): string {
  const contract = input.communicationContract;
  return [
    contract.audience,
    contract.objective,
    contract.desiredOutcome,
    contract.coreMessage,
    contract.deliveryContext,
    contract.afterUse,
    input.sourceText ?? "",
  ].join(" ").toLocaleLowerCase();
}

function includesAny(source: string, signals: readonly string[]): boolean {
  return signals.some((signal) => source.includes(signal.toLocaleLowerCase()));
}

function inferArgumentMode(source: string): ArgumentMode {
  if (includesAny(source, ["教学", "培训", "课程", "教程", "explain", "training", "course", "onboarding"])) {
    return "instructional";
  }
  if (includesAny(source, ["发布", "揭晓", "舞台", "路演", "launch", "keynote", "showcase", "demo day"])) {
    return "showcase";
  }
  if (includesAny(source, ["故事", "转型", "旅程", "案例", "story", "journey", "fundraising", "pitch"])) {
    return "narrative";
  }
  if (includesAny(source, ["同步", "状态", "交接", "纪要", "status", "briefing", "handoff", "reference"])) {
    return "briefing";
  }
  return "pyramid";
}

function inferReadingMode(source: string): ReadingMode {
  if (includesAny(source, ["异步", "留档", "材料", "会后阅读", "async", "leave-behind", "document", "reference"])) {
    return "text";
  }
  if (includesAny(source, ["现场", "舞台", "大屏", "演讲", "keynote", "on stage", "live presentation"])) {
    return "presentation";
  }
  return "balanced";
}

function systemFor(
  visualStyle: VisualStyle,
  argumentMode: ArgumentMode,
  readingMode: ReadingMode,
  colorScheme?: ColorScheme,
): DesignSystemV2 {
  const preset = selectDesignPreset({
    visualStyle,
    argumentMode,
    readingMode,
    ...(colorScheme ? { colorScheme } : {}),
  });
  return designSystemV2Schema.parse(preset);
}

function makeDirection(
  tier: DesignDirection["tier"],
  visualStyle: VisualStyle,
  argumentMode: ArgumentMode,
  readingMode: ReadingMode,
  colorScheme: ColorScheme | undefined,
  reason: string,
): DesignDirection {
  const definition = getVisualStyleDefinition(visualStyle);
  const tierLabel = tier === "locked"
    ? "已锁定"
    : tier === "safe"
      ? "稳健"
      : tier === "shifted"
        ? "偏移"
        : "大胆";
  return {
    id: `direction-${tier}`,
    tier,
    label: `${tierLabel} · ${definition.label}`,
    rationale: `${reason} ${definition.summary}`,
    designSystem: systemFor(
      visualStyle,
      argumentMode,
      readingMode,
      colorScheme,
    ),
  };
}

/**
 * Resolve the deck-wide communication and visual decision before any page
 * layout is chosen. The result is pure and can be shared by tools and UI.
 */
export function resolveDesignPlan(input: ResolveDesignPlanInput): DesignPlanCandidate {
  const source = normalizedSource(input);
  const argumentMode = input.argumentMode ?? inferArgumentMode(source);
  const readingMode = input.readingMode ?? inferReadingMode(source);

  if (input.visualStyle) {
    const direction = makeDirection(
      "locked",
      input.visualStyle,
      argumentMode,
      readingMode,
      input.colorScheme,
      "用户已明确视觉风格，直接锁定并保留独立的论证、色彩与阅读模式。",
    );
    return designPlanCandidateSchema.parse({
      version: 2,
      communicationContract: input.communicationContract,
      selectionSource: "user-locked",
      directions: [direction],
      recommendedDirectionId: direction.id,
    });
  }

  const profile = SPECTRUM_PROFILES.find((candidate) =>
    includesAny(source, candidate.signals)
  ) ?? DEFAULT_PROFILE;
  const tiers = ["safe", "shifted", "bold"] as const;
  const directions = profile.styles.map((style, index) =>
    makeDirection(
      tiers[index],
      style,
      argumentMode,
      readingMode,
      input.colorScheme,
      profile.reason,
    )
  );

  return designPlanCandidateSchema.parse({
    version: 2,
    communicationContract: input.communicationContract,
    selectionSource: "recommended-spectrum",
    directions,
    recommendedDirectionId: `direction-${profile.recommendedTier}`,
  });
}
