import { useEffect } from "react";
import type {
  ComputedColorScheme,
  UiAccentColor,
  UiColorScheme,
  UiControlShape,
  UiSkin,
} from "./appBootstrap";
import { resolveColorScheme } from "./appBootstrap";

interface AppearanceRuntimeOptions {
  skin: UiSkin;
  colorScheme: UiColorScheme;
  computedScheme: ComputedColorScheme;
  borderRadiusScale: number;
  uiAccentColor: UiAccentColor;
  uiControlShape: UiControlShape;
}

/**
 * Applies skin × color-scheme to the document. Surfaces come from CSS skins;
 * this hook only sets data attributes and window chrome.
 */
export function useAppearanceRuntime({
  skin,
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
    if (!desktopApi?.setWindowThemeMode) return;

    void desktopApi
      .setWindowThemeMode(colorScheme === "system" ? "system" : computedScheme)
      .catch((error) => {
        console.error("同步窗口主题失败:", error);
      });
  }, [skin, colorScheme, computedScheme]);

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
