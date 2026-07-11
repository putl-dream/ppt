import { z } from "zod";

export type LayoutVisualMode = "template" | "creative";

export const layoutChoiceSchema = z.object({
  mode: z.enum(["template", "creative"]),
  theme: z.string().trim().min(1),
  palette: z.string().trim().min(1),
});

export type LayoutChoice = z.infer<typeof layoutChoiceSchema>;

export const LAYOUT_PREFERENCE_STORAGE_KEY = "ppt-layout-visual-mode";

export const LAYOUT_THEME_OPTIONS = [
  { theme: "ocean", palette: "cyan", label: "海洋 · 青" },
  { theme: "nordic", palette: "cyan", label: "北欧 · 青" },
  { theme: "midnight", palette: "cyan", label: "午夜 · 青" },
  { theme: "sunset", palette: "orange", label: "日落 · 橙" },
  { theme: "purple", palette: "purple", label: "紫韵 · 紫" },
] as const;

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
export function buildLayoutPhasePrompt(mode: LayoutVisualMode, theme: string, palette: string): string {
  const modeLabel = mode === "creative" ? "创意装饰" : "标准";
  return `排版方式已确认：${modeLabel}模式；主题 ${theme}；调色板 ${palette}。`;
}
