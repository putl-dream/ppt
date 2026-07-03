export type LayoutVisualMode = "template" | "creative";

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

export function buildLayoutPhasePrompt(mode: LayoutVisualMode, theme: string, palette: string): string {
  if (mode === "creative") {
    return [
      "请对当前演示文稿执行创意装饰排版（第二阶段）。",
      "1. LoadSkill ppt-beautify",
      "2. set-theme 应用主题",
      `3. 主题：${theme}，调色板：${palette}`,
      "4. 对所有内容页执行 update-slide-layout（使用各页已有 layout 字段）",
      "5. 在标准排版基础上为 process/comparison 页添加 arrow、line、circle 等 shape 装饰",
      "6. 禁止在画布重复 slide.title；每条要点保持独立 text element",
    ].join("\n");
  }

  return [
    "请对当前演示文稿执行标准排版（第二阶段）。",
    "1. LoadSkill ppt-build",
    "2. set-theme 并提交",
    `3. 主题：${theme}，调色板：${palette}`,
    "4. 对所有内容页批量 SubmitCommands：update-slide-layout（layout 取各 slide 已有值，缺省用 summary）",
    "5. 禁止在画布放标题文本；禁止手动坐标堆叠",
    "6. 完成后 LoadSkill deck-review 做简要质检",
  ].join("\n");
}
