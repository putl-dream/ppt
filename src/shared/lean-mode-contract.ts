import { z } from "zod";

export const LEAN_GENERATION_MODES = ["agent", "lean"] as const;
export const leanGenerationModeSchema = z.enum(LEAN_GENERATION_MODES);
export type LeanGenerationMode = z.infer<typeof leanGenerationModeSchema>;

export interface LeanRunMetrics {
  mode: "lean";
  modelCalls: 1 | 2;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  durationMs: number;
  compileDurationMs: number;
  directorDurationMs?: number;
  assetResolutionDurationMs?: number;
  qualityDurationMs?: number;
  assetRequestCount?: number;
  resolvedAssetCount?: number;
  sceneCount?: number;
  commercialQualityScore?: number;
  canonicalHash?: string;
  visualReviewStatus?: "not-available" | "approved" | "revised" | "failed";
  visualReviewThumbnailCount?: number;
  visualReviewDurationMs?: number;
  slideCount: number;
  requestChars: number;
  specChars: number;
}

export function formatLeanRunMetrics(metrics: LeanRunMetrics): string {
  const tokens = metrics.totalTokens === null
    ? "token 未报告"
    : `${metrics.totalTokens.toLocaleString("zh-CN")} tokens`;
  const visualReview = metrics.visualReviewStatus
    ? `视觉复盘 ${metrics.visualReviewStatus}`
    : undefined;
  return [
    "Lean Mode",
    `${metrics.modelCalls} 次模型调用`,
    `${metrics.slideCount} 页`,
    tokens,
    `${(metrics.durationMs / 1_000).toFixed(1)} 秒`,
    visualReview,
  ].filter((value): value is string => Boolean(value)).join(" · ");
}
