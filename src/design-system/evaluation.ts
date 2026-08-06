/**
 * Internal / experimental deck visual heuristics.
 *
 * Not a product quality gate: Preview/Submit and CommitGate do not call this
 * module. Live apply-time quality is DeckValidationService + CommitGate
 * `quality_report`. Keep this library for unit tests and offline experiments only.
 */
import type { Slide } from "@shared/presentation";
import type { DesignSystemV2 } from "./schema";

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

export type EvaluationSlide = Pick<
  Slide,
  "id" | "visualSource" | "narrative" | "designOverride" | "title"
>;

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const SVG_BASE_SCORES: SlideVisualScores = {
  hierarchy: 90,
  readability: 90,
  density: 90,
  visualAnchor: 90,
  composition: 90,
  overall: 90,
};

function evaluateSlide(slide: EvaluationSlide): SlideVisualEvaluation {
  const issues: VisualIssue[] = [];
  if (!slide.narrative) {
    issues.push({
      code: "missing-narrative",
      severity: "warning",
      message: "SVG page is missing its page narrative contract.",
      suggestion: "Provide role, coreMessage, audienceMove, rhythm, and layoutIntent.",
    });
  }
  const scores =
    slide.visualSource?.kind === "svg"
      ? { ...SVG_BASE_SCORES, overall: issues.length > 0 ? 82 : SVG_BASE_SCORES.overall }
      : {
          hierarchy: 45,
          readability: 45,
          density: 45,
          visualAnchor: 45,
          composition: 45,
          overall: 45,
        };
  if (slide.visualSource?.kind !== "svg") {
    issues.push({
      code: "non-svg-slide",
      severity: "error",
      message: "Slide is not SVG-native.",
      suggestion: "Submit a complete SVG page as the slide visual source.",
    });
  }
  return { slideId: slide.id, scores, issues };
}

export function evaluateDeckVisualQuality(
  _system: DesignSystemV2,
  slides: EvaluationSlide[],
): DeckVisualEvaluation {
  const evaluations = slides.map((slide) => evaluateSlide(slide));
  const emptyDeck = slides.length === 0;
  const keys: VisualScoreKey[] = [
    "hierarchy",
    "readability",
    "density",
    "visualAnchor",
    "composition",
  ];
  const base = Object.fromEntries(
    keys.map((key) => [key, clamp(average(evaluations.map((item) => item.scores[key])))]),
  ) as Record<VisualScoreKey, number>;

  const overrideSignatures = new Set(
    slides
      .filter((slide) => slide.designOverride && Object.keys(slide.designOverride).length > 0)
      .map((slide) =>
        JSON.stringify(slide.designOverride, Object.keys(slide.designOverride ?? {}).sort()),
      ),
  );
  const allowedOverrides = Math.max(2, Math.ceil(slides.length * 0.25));
  const consistency = emptyDeck
    ? 0
    : clamp(100 - Math.max(0, overrideSignatures.size - allowedOverrides) * 12);

  const layoutSignatures = new Set(
    slides.map((slide) =>
      slide.visualSource?.kind === "svg"
        ? `svg/${slide.narrative?.rhythm ?? "unset"}/${slide.narrative?.layoutIntent ?? slide.visualSource.sha256}`
        : "legacy/non-svg",
    ),
  );
  const differentiation = emptyDeck
    ? 0
    : slides.length <= 2
      ? 100
      : clamp(45 + Math.min(55, (layoutSignatures.size / slides.length) * 90));

  const issues: VisualIssue[] = [];
  if (emptyDeck) {
    issues.push({
      code: "empty-deck",
      severity: "error",
      message: "演示文稿没有任何幻灯片，无法进行视觉质量确认。",
      suggestion: "先创建并排版至少一页幻灯片。",
    });
  }
  if (consistency < 80) {
    issues.push({
      code: "deck-style-drift",
      severity: "warning",
      message: "页面级设计覆盖过多，整套视觉语言开始漂移。",
      suggestion: "将共性收回 deck 级 DesignSystem，只保留有叙事意义的页面覆盖。",
    });
  }
  if (differentiation < 70) {
    issues.push({
      code: "deck-repetition",
      severity: "warning",
      message: "页面版式重复度较高。",
      suggestion: "按叙事角色切换 rhythm、layoutIntent 或明暗节奏。",
    });
  }

  const scores: DeckVisualScores = {
    ...base,
    consistency,
    differentiation,
    overall: clamp(
      base.hierarchy * 0.17 +
        base.readability * 0.17 +
        base.density * 0.13 +
        base.visualAnchor * 0.11 +
        base.composition * 0.14 +
        consistency * 0.16 +
        differentiation * 0.12,
    ),
  };
  return { scores, slides: evaluations, issues };
}
