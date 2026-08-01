import { useEffect } from "react";
import type {
  ComputedColorScheme,
  UiAccentColor,
  UiColorScheme,
  UiControlShape,
  UiSkin,
} from "./appBootstrap";
import { resolveColorScheme } from "./appBootstrap";
import {
  applyUserUiThemeCss,
  BUILTIN_UI_THEME_ID,
} from "./userUiTheme";

interface AppearanceRuntimeOptions {
  skin: UiSkin;
  uiThemeId: string;
  colorScheme: UiColorScheme;
  computedScheme: ComputedColorScheme;
  borderRadiusScale: number;
  uiAccentColor: UiAccentColor;
  uiControlShape: UiControlShape;
}

/**
 * Applies skin × color-scheme to the document. Surfaces come from CSS skins;
 * this hook only sets data attributes, optional user theme CSS, and window chrome.
 */
export function useAppearanceRuntime({
  skin,
  uiThemeId,
  colorScheme,
  computedScheme,
  borderRadiusScale,
  uiAccentColor,
  uiControlShape,
}: AppearanceRuntimeOptions): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = skin;
    root.dataset.colorScheme = computedScheme;
    root.style.colorScheme = computedScheme;
    root.classList.remove("dark-theme");

    const desktopApi = window.desktopApi;
    // #region agent log
    const debugLog = (hypothesisId: string, message: string, data: Record<string, unknown>) => {
      fetch("http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6f9302" },
        body: JSON.stringify({
          sessionId: "6f9302",
          runId: "titlebar-overlay-theme",
          hypothesisId,
          location: "useAppearanceRuntime.ts:appearance-effect",
          message,
          data,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    };
    debugLog("H1", "renderer appearance effect fired", {
      skin,
      colorScheme,
      computedScheme,
      sentThemeMode: colorScheme === "system" ? "system" : computedScheme,
      hasDesktopApi: Boolean(desktopApi),
      hasSetWindowThemeMode: Boolean(desktopApi?.setWindowThemeMode),
    });
    requestAnimationFrame(() => {
      const overlayApi = (
        navigator as unknown as {
          windowControlsOverlay?: {
            visible: boolean;
            getTitlebarAreaRect: () => DOMRect;
          };
        }
      ).windowControlsOverlay;
      const titlebar = document.querySelector(".window-titlebar");
      const titlebarStyle = titlebar ? getComputedStyle(titlebar) : null;
      const rootStyle = getComputedStyle(root);
      const rect = overlayApi?.visible ? overlayApi.getTitlebarAreaRect() : null;
      debugLog("H6|H7", "window chrome geometry and colors", {
        wcoSupported: Boolean(overlayApi),
        wcoVisible: overlayApi?.visible ?? null,
        titlebarAreaRect: rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null,
        innerWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio,
        datasetColorScheme: root.dataset.colorScheme,
        datasetSkin: root.dataset.skin,
        surfaceBase: rootStyle.getPropertyValue("--surface-base").trim(),
        surfaceCanvas: rootStyle.getPropertyValue("--surface-canvas").trim(),
        titlebarBackground: titlebarStyle?.backgroundColor ?? null,
        titlebarColor: titlebarStyle?.color ?? null,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
      });
    });
    // #endregion
    if (!desktopApi?.setWindowThemeMode) return;

    void desktopApi
      .setWindowThemeMode(colorScheme === "system" ? "system" : computedScheme)
      // #region agent log
      .then((resolvedTheme) => {
        debugLog("H1|H3", "main process acknowledged theme mode", {
          sentThemeMode: colorScheme === "system" ? "system" : computedScheme,
          resolvedTheme,
        });
      })
      // #endregion
      .catch((error) => {
        // #region agent log
        debugLog("H3", "setWindowThemeMode rejected", {
          sentThemeMode: colorScheme === "system" ? "system" : computedScheme,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
        // #endregion
        console.error("同步窗口主题失败:", error);
      });
  }, [skin, colorScheme, computedScheme]);

  useEffect(() => {
    let cancelled = false;

    const clearTheme = () => {
      if (!cancelled) applyUserUiThemeCss(null);
    };

    if (uiThemeId === BUILTIN_UI_THEME_ID) {
      clearTheme();
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
    document.documentElement.style.setProperty(
      "--content-radius-scale",
      borderRadiusScale.toString(),
    );
  }, [borderRadiusScale]);

  useEffect(() => {
    document.documentElement.dataset.accent = uiAccentColor;
  }, [uiAccentColor]);

  useEffect(() => {
    document.documentElement.dataset.controlShape = uiControlShape;
  }, [uiControlShape]);
}

export function getComputedScheme(colorScheme: UiColorScheme): ComputedColorScheme {
  return resolveColorScheme(colorScheme);
}
