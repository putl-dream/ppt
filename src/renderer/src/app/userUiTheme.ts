import {
  BUILTIN_UI_THEME_IDS,
  CATNIP_UI_THEME_ID,
  DEFAULT_UI_THEME_ID,
} from "@shared/ui-themes";
import catnipThemeCss from "../styles/themes/catnip.css?raw";

export const BUILTIN_UI_THEME_ID = DEFAULT_UI_THEME_ID;
export const USER_UI_THEME_STYLE_ID = "user-ui-theme";

export function getBuiltinUiThemeCss(id: string): string | null | undefined {
  if (id === DEFAULT_UI_THEME_ID) return null;
  if (id === CATNIP_UI_THEME_ID) return catnipThemeCss;
  return undefined;
}

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
  if (BUILTIN_UI_THEME_IDS.has(id)) return id;
  if (availableThemeIds.size === 0) return id;
  return availableThemeIds.has(id) ? id : BUILTIN_UI_THEME_ID;
}
