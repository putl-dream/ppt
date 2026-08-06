import { useEffect } from "react";
import type { ComputedColorScheme, UiColorScheme, UiFontFamily, UiSkin } from "./appBootstrap";
import { resolveColorScheme } from "./appBootstrap";
import { applyUiTypography } from "./uiTypography";
import { applyUserUiThemeCss, getBuiltinUiThemeCss } from "./userUiTheme";

interface AppearanceRuntimeOptions {
  skin: UiSkin;
  uiThemeId: string;
  colorScheme: UiColorScheme;
  computedScheme: ComputedColorScheme;
  uiFontFamily: UiFontFamily;
  uiFontSize: number;
  uiLineHeight: number;
}

/**
 * Applies skin × color-scheme to the document. Surfaces come from CSS skins;
 * this hook only sets data attributes, optional user theme CSS, typography, and window chrome.
 */
export function useAppearanceRuntime({
  skin,
  uiThemeId,
  colorScheme,
  computedScheme,
  uiFontFamily,
  uiFontSize,
  uiLineHeight,
}: AppearanceRuntimeOptions): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = skin;
    root.dataset.colorScheme = computedScheme;
    root.style.colorScheme = computedScheme;
    root.classList.remove("dark-theme");

    const desktopApi = window.desktopApi;
    if (!desktopApi?.setWindowThemeMode) return;

    void desktopApi
      .setWindowThemeMode(colorScheme === "system" ? "system" : computedScheme)
      .catch((error) => {
        console.error("同步窗口主题失败:", error);
      });
  }, [skin, colorScheme, computedScheme]);

  useEffect(() => {
    let cancelled = false;

    const clearTheme = () => {
      if (!cancelled) applyUserUiThemeCss(null);
    };

    const builtinCss = getBuiltinUiThemeCss(uiThemeId);
    if (builtinCss !== undefined) {
      if (!cancelled) applyUserUiThemeCss(builtinCss);
      return () => {
        cancelled = true;
      };
    }

    const desktopApi = window.desktopApi;
    if (!desktopApi?.readUiThemeCss) {
      clearTheme();
      return () => {
        cancelled = true;
      };
    }

    void desktopApi
      .readUiThemeCss(uiThemeId)
      .then((css) => {
        if (cancelled) return;
        applyUserUiThemeCss(typeof css === "string" && css.length > 0 ? css : null);
      })
      .catch((error) => {
        if (!cancelled) {
          applyUserUiThemeCss(null);
          console.error("加载自定义 UI 主题失败:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [uiThemeId]);

  useEffect(() => {
    applyUiTypography(uiFontFamily, uiFontSize, uiLineHeight);
  }, [uiFontFamily, uiFontSize, uiLineHeight]);
}

export function getComputedScheme(colorScheme: UiColorScheme): ComputedColorScheme {
  return resolveColorScheme(colorScheme);
}
