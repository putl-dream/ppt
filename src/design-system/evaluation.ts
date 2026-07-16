import type { DesignSystemV1 } from "./schema";
import { resolveSlideStyle } from "./resolver";

export type VisualScoreKey =
  | "hierarchy"
  | "readability"
  | "density"
  | "visualAnchor"
  | "composition";

export interface VisualIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
  suggestion: string;
}

export interface SlideVisualScores extends Record<VisualScoreKey, number> {
  overall: number;
}

export interface SlideVisualEvaluation {
  slideId: string;
  scores: SlideVisualScores;
  issues: VisualIssue[];
}

export interface DeckVisualScores {
  hierarchy: number;
  readability: number;
  density: number;
  visualAnchor: number;
  composition: number;
  consistency: number;
  differentiation: number;
  overall: number;
}

export interface DeckVisualEvaluation {
  scores: DeckVisualScores;
  slides: SlideVisualEvaluation[];
  issues: VisualIssue[];
}

interface EvaluationElement {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
  textRole?: string;
}

export interface EvaluationSlide {
  id: string;
  layout?: string;
  grammarVariant?: string;
  slideVariant?: "light" | "dark" | "hero";
  designOverride?: Record<string, unknown>;
  elements: EvaluationElement[];
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const average = (values: number[]): number => values.length === 0
  ? 0
  : values.reduce((sum, value) => sum + value, 0) / values.length;
const SAFE_MARGIN = 40;

function overlaps(left: EvaluationElement, right: EvaluationElement): boolean {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  );
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number];
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const channels = rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function evaluateSlide(system: DesignSystemV1, slide: EvaluationSlide): SlideVisualEvaluation {
  const style = resolveSlideStyle(system, slide);
  const texts = slide.elements.filter((element) => element.type === "text");
  const fontSizes = texts.map((element) => element.fontSize ?? 32);
  const title = texts.find((element) => element.textRole === "title")
    ?? texts.reduce<EvaluationElement | undefined>((largest, element) =>
      !largest || (element.fontSize ?? 32) > (largest.fontSize ?? 32) ? element : largest, undefined);
  const bodySizes = texts.filter((element) => element !== title).map((element) => element.fontSize ?? 32);
  const titleSize = title?.fontSize ?? 0;
  const bodyAverage = bodySizes.length > 0 ? average(bodySizes) : Math.max(titleSize / 2, 1);
  const hierarchy = texts.length === 0
    ? 45
    : clamp(55 + Math.min(35, Math.max(0, (titleSize / bodyAverage - 1) * 35)) + (title?.textRole === "title" ? 10 : 0));

  const minimumFont = fontSizes.length > 0 ? Math.min(...fontSizes) : 32;
  const textCharacters = texts.reduce((sum, element) => sum + (element.text?.length ?? 0), 0);
  const contrast = contrastRatio(style.colors.body, style.colors.bg);
  const readability = clamp(
    100
    - Math.max(0, 18 - minimumFont) * 5
    - Math.max(0, textCharacters - 650) / 12
    - Math.max(0, 4.5 - contrast) * 12,
  );

  const densityTargets = {
    calm: { elements: 8, characters: 420 },
    standard: { elements: 12, characters: 650 },
    dense: { elements: 17, characters: 900 },
  } as const;
  const target = densityTargets[style.density];
  const density = clamp(
    100
    - Math.max(0, slide.elements.length - target.elements) * 6
    - Math.max(0, textCharacters - target.characters) / 14,
  );

  const hasPrimaryVisual = slide.elements.some((element) =>
    element.type === "image" || element.type === "chart" || element.type === "table");
  const hasSecondaryVisual = slide.elements.some((element) =>
    element.type === "icon" || element.type === "shape" || element.textRole === "metric");
  const visualAnchor = hasPrimaryVisual ? 100 : hasSecondaryVisual ? 78 : slide.layout === "cover" ? 80 : 48;

  const outOfBounds = slide.elements.filter((element) =>
    element.x < SAFE_MARGIN
    || element.y < SAFE_MARGIN
    || element.x + element.width > 1280 - SAFE_MARGIN
    || element.y + element.height > 720 - SAFE_MARGIN).length;
  const tinyElements = slide.elements.filter((element) => element.width < 24 || element.height < 12).length;
  const foregroundElements = slide.elements.filter((element) => element.type !== "shape");
  let overlapCount = 0;
  for (let left = 0; left < foregroundElements.length; left += 1) {
    for (let right = left + 1; right < foregroundElements.length; right += 1) {
      if (overlaps(foregroundElements[left], foregroundElements[right])) overlapCount += 1;
    }
  }
  const composition = clamp(
    100 - outOfBounds * 25 - tinyElements * 8 - overlapCount * 22,
  );

  const scores: SlideVisualScores = {
    hierarchy,
    readability,
    density,
    visualAnchor,
    composition,
    overall: clamp(
      hierarchy * 0.24
      + readability * 0.24
      + density * 0.18
      + visualAnchor * 0.16
      + composition * 0.18,
    ),
  };

  const issues: VisualIssue[] = [];
  if (hierarchy < 70) issues.push({ code: "weak-hierarchy", severity: "warning", message: "标题与正文的字号层级不够清晰。", suggestion: "增大标题字号或降低正文层级，并标注 title/textRole。" });
  if (readability < 75) issues.push({ code: "readability", severity: readability < 55 ? "error" : "warning", message: "文字尺寸、篇幅或对比度影响阅读。", suggestion: "压缩文案、提高最小字号，并使用解析后的正文色。" });
  if (density < 70) issues.push({ code: "over-density", severity: "warning", message: "当前页面超过设计系统的密度预算。", suggestion: "删减次要信息，或改用更适合高密度内容的版式。" });
  if (visualAnchor < 70) issues.push({ code: "missing-visual-anchor", severity: "warning", message: "页面缺少明确的视觉锚点。", suggestion: "加入与叙事相关的图片、图表、关键数字或结构图。" });
  if (composition < 80) issues.push({
    code: "composition-bounds",
    severity: "error",
    message: overlapCount > 0
      ? "存在内容元素重叠、越过安全边距或尺寸过小的问题。"
      : "存在越过安全边距或尺寸过小的元素。",
    suggestion: "重新应用布局槽位，并检查内容元素重叠和安全边距。",
  });

  return { slideId: slide.id, scores, issues };
}

export function evaluateDeckVisualQuality(
  system: DesignSystemV1,
  slides: EvaluationSlide[],
): DeckVisualEvaluation {
  const evaluations = slides.map((slide) => evaluateSlide(system, slide));
  const emptyDeck = slides.length === 0;
  const keys: VisualScoreKey[] = ["hierarchy", "readability", "density", "visualAnchor", "composition"];
  const base = Object.fromEntries(keys.map((key) => [key, clamp(average(evaluations.map((item) => item.scores[key])))]) ) as Record<VisualScoreKey, number>;

  const overrideSignatures = new Set(slides
    .filter((slide) => slide.designOverride && Object.keys(slide.designOverride).length > 0)
    .map((slide) => JSON.stringify(slide.designOverride, Object.keys(slide.designOverride ?? {}).sort())));
  const allowedOverrides = Math.max(2, Math.ceil(slides.length * 0.25));
  const consistency = emptyDeck
    ? 0
    : clamp(100 - Math.max(0, overrideSignatures.size - allowedOverrides) * 12);

  const layoutSignatures = new Set(slides.map((slide) =>
    `${slide.layout ?? "unset"}/${slide.grammarVariant ?? "default"}/${slide.slideVariant ?? "default"}`));
  const differentiation = emptyDeck
    ? 0
    : slides.length <= 2
    ? 100
    : clamp(45 + Math.min(55, (layoutSignatures.size / slides.length) * 90));

  const issues: VisualIssue[] = [];
  if (emptyDeck) issues.push({
    code: "empty-deck",
    severity: "error",
    message: "演示文稿没有任何幻灯片，无法进行视觉质量确认。",
    suggestion: "先创建并排版至少一页幻灯片。",
  });
  if (consistency < 80) issues.push({ code: "deck-style-drift", severity: "warning", message: "页面级设计覆盖过多，整套视觉语言开始漂移。", suggestion: "将共性收回 deck 级 DesignSystem，只保留有叙事意义的页面覆盖。" });
  if (differentiation < 70) issues.push({ code: "deck-repetition", severity: "warning", message: "页面版式重复度较高。", suggestion: "按叙事角色切换 grammarVariant、布局或明暗节奏。" });

  const scores: DeckVisualScores = {
    ...base,
    consistency,
    differentiation,
    overall: clamp(
      base.hierarchy * 0.17
      + base.readability * 0.17
      + base.density * 0.13
      + base.visualAnchor * 0.11
      + base.composition * 0.14
      + consistency * 0.16
      + differentiation * 0.12,
    ),
  };
  return { scores, slides: evaluations, issues };
}
