import type { DesignSystemV1 } from "./schema";

export interface DesignPreset { id: string; label: string; system: DesignSystemV1 }

export const DESIGN_PRESETS: readonly DesignPreset[] = [
  { id: "business", label: "商务蓝", system: { version: 1, tokens: { palette: "business-blue", fontMood: "formal", shapeLanguage: "cards", backgroundStyle: "clean", motif: "none", density: "standard", imageTreatment: "plain", chartStyle: "report" } } },
  { id: "editorial", label: "暖纸编辑", system: { version: 1, tokens: { palette: "warm-paper", fontMood: "editorial", shapeLanguage: "editorial", backgroundStyle: "paper", motif: "margin-note", density: "calm", imageTreatment: "framed", chartStyle: "editorial" } } },
  { id: "technical", label: "科技暗色", system: { version: 1, tokens: { palette: "tech-dark", fontMood: "technical", shapeLanguage: "geometric", backgroundStyle: "dark", motif: "path-line", density: "standard", imageTreatment: "masked", chartStyle: "dashboard" } } },
  { id: "academic", label: "学术柔和", system: { version: 1, tokens: { palette: "soft-academic", fontMood: "formal", shapeLanguage: "annotation", backgroundStyle: "grid", motif: "bookmark", density: "calm", imageTreatment: "captioned", chartStyle: "report" } } },
  { id: "report", label: "黑白报告", system: { version: 1, tokens: { palette: "mono-report", fontMood: "minimal", shapeLanguage: "cards", backgroundStyle: "clean", motif: "chapter-number", density: "dense", imageTreatment: "framed", chartStyle: "minimal" } } },
] as const;
