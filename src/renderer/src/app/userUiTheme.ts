export const BUILTIN_UI_THEME_ID = "studio";
export const USER_UI_THEME_STYLE_ID = "user-ui-theme";

export function applyUserUiThemeCss(css: string | null): void {
  if (typeof document === "undefined") return;

  const existing = document.getElementById(USER_UI_THEME_STYLE_ID);
  if (!css) {
    existing?.remove();
    return;
  }

  let styleElement = existing instanceof HTMLStyleElement ? existing : null;
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = USER_UI_THEME_STYLE_ID;
    document.head.appendChild(styleElement);
  }
  styleElement.textContent = css;
}

export function normalizePersistedUiThemeId(
  value: unknown,
  availableThemeIds: ReadonlySet<string> = new Set(),
): string {
  if (typeof value !== "string" || !value.trim()) return BUILTIN_UI_THEME_ID;
  const id = value.trim();
  if (id === BUILTIN_UI_THEME_ID) return BUILTIN_UI_THEME_ID;
  if (availableThemeIds.size === 0) return id;
  return availableThemeIds.has(id) ? id : BUILTIN_UI_THEME_ID;
}
