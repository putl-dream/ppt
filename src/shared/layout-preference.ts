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
      "1. LoadSkill ppt-design-layout",
      "2. Task 按 Rubric 写入 slides/layout-plan.json（不改文案）",
      "3. LoadSkill ppt-layout（Executor）按 plan 执行",
      "4. set-theme 应用主题",
      `5. 主题：${theme}，调色板：${palette}`,
      "6. update-slide-layout / update-slide-variant；过长文案用 compress-text 或 beautify 精简",
      "7. 创意模式：process/comparison 页可 AddLayoutDecorations",
      "8. LoadSkill deck-review 做简要质检",
    ].join("\n");
  }

  return [
    "请对当前演示文稿执行标准排版（第二阶段）。",
    "1. LoadSkill ppt-design-layout",
    "2. Task 写入 slides/layout-plan.json（不改文案）",
    "3. LoadSkill ppt-layout（Executor）按 plan 执行",
    "4. set-theme 并提交",
    `5. 主题：${theme}，调色板：${palette}`,
    "6. 批量 update-slide-layout（+ variant）",
    "7. 溢出或过长要点：ExecuteExtraTool compress-text / beautify 等，在排版阶段精简",
    "8. LoadSkill deck-review 做简要质检",
  ].join("\n");
}
