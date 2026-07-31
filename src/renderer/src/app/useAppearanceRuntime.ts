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
  colorContrastOffset: number;
  uiAccentColor: UiAccentColor;
  uiControlShape: UiControlShape;
}

/**
 * Applies skin × color-scheme to the document. Surfaces come from CSS skins;
 * this hook only sets data attributes, contrast offset, and window chrome.
 */
export function useAppearanceRuntime({
  skin,
  colorScheme,
  computedScheme,
  borderRadiusScale,
  colorContrastOffset,
  uiAccentColor,
  uiControlShape,
}: AppearanceRuntimeOptions): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = skin;
    root.dataset.colorScheme = computedScheme;
    root.style.colorScheme = computedScheme;
    root.classList.toggle("dark-theme", computedScheme === "dark");

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

  useEffect(() => {
    /* Contrast offset nudges surface lightness without owning the palette. */
    const offset = Math.max(-10, Math.min(15, colorContrastOffset));
    document.documentElement.style.setProperty(
      "--contrast-offset",
      `${offset}`,
    );
  }, [colorContrastOffset]);
}

export function getComputedScheme(colorScheme: UiColorScheme): ComputedColorScheme {
  return resolveColorScheme(colorScheme);
}

/** @deprecated Use getComputedScheme */
export function getComputedTheme(colorScheme: UiColorScheme): ComputedColorScheme {
  return getComputedScheme(colorScheme);
}
