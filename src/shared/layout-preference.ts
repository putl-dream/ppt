import { z } from "zod";
import { DESIGN_PRESETS, designSystemV1Schema, type DesignSystemV1 } from "@design-system";

export type LayoutVisualMode = "template" | "creative";

export const layoutChoiceSchema = z.object({
  mode: z.enum(["template", "creative"]),
  designSystem: designSystemV1Schema,
});

export type LayoutChoice = z.infer<typeof layoutChoiceSchema>;

export const LAYOUT_PREFERENCE_STORAGE_KEY = "ppt-layout-visual-mode";

export const LAYOUT_DESIGN_OPTIONS = DESIGN_PRESETS;

export function loadLayoutVisualMode(): LayoutVisualMode {
  if (typeof window === "undefined") return "template";
  const stored = window.localStorage.getItem(LAYOUT_PREFERENCE_STORAGE_KEY);
  return stored === "creative" ? "creative" : "template";
}

export function saveLayoutVisualMode(mode: LayoutVisualMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAYOUT_PREFERENCE_STORAGE_KEY, mode);
}

/** Agent 内部执行指令（不直接展示在聊天气泡中）。 */
export function buildLayoutPhasePrompt(mode: LayoutVisualMode, designSystem: DesignSystemV1): string {
  const modeLabel = mode === "creative" ? "创意装饰" : "标准";
  return `排版方式已确认：${modeLabel}模式；设计系统 ${JSON.stringify(designSystem)}。`;
}
