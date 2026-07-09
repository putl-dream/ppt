import { useEffect } from "react";
import type {
  UiAccentColor,
  UiControlShape,
  UiReadingTone,
  UiThemeMode,
} from "./appBootstrap";

export type ComputedTheme = "light" | "dark";

type ReadingTonePalette = Record<
  UiReadingTone,
  Record<
    ComputedTheme,
    {
      hue: number;
      saturation: number;
      app: number;
      canvas: number;
      field: number;
      darker: number;
    }
  >
>;

const READING_TONE_PALETTE: ReadingTonePalette = {
  classic: {
    light: { hue: 0, saturation: 0, app: 90.6, canvas: 100, field: 100, darker: 95 },
    dark: { hue: 0, saturation: 0, app: 12, canvas: 18, field: 18, darker: 12 },
  },
  cyan: {
    light: { hue: 188, saturation: 28, app: 90, canvas: 97, field: 98, darker: 92 },
    dark: { hue: 188, saturation: 18, app: 11, canvas: 15, field: 18, darker: 12 },
  },
  orange: {
    light: { hue: 34, saturation: 34, app: 90, canvas: 97, field: 96, darker: 91 },
    dark: { hue: 30, saturation: 18, app: 11, canvas: 15, field: 18, darker: 12 },
  },
};

interface AppearanceRuntimeOptions {
  themeMode: UiThemeMode;
  computedTheme: ComputedTheme;
  borderRadiusScale: number;
  colorContrastOffset: number;
  uiAccentColor: UiAccentColor;
  uiControlShape: UiControlShape;
  uiReadingTone: UiReadingTone;
}

export function getComputedTheme(themeMode: UiThemeMode): ComputedTheme {
  return themeMode === "dark" ? "dark" : "light";
}

export function useAppearanceRuntime({
  themeMode,
  computedTheme,
  borderRadiusScale,
  colorContrastOffset,
  uiAccentColor,
  uiControlShape,
  uiReadingTone,
}: AppearanceRuntimeOptions): void {
  useEffect(() => {
    document.documentElement.style.colorScheme = computedTheme;
    const desktopApi = window.desktopApi;
    if (!desktopApi?.setWindowThemeMode) return;

    void desktopApi
      .setWindowThemeMode(themeMode)
      .catch((error) => {
        console.error("同步窗口主题失败:", error);
      });
  }, [computedTheme, themeMode]);

  useEffect(() => {
    document.documentElement.style.setProperty("--content-radius-scale", borderRadiusScale.toString());
  }, [borderRadiusScale]);

  useEffect(() => {
    document.documentElement.dataset.accent = uiAccentColor;
  }, [uiAccentColor]);

  useEffect(() => {
    document.documentElement.dataset.controlShape = uiControlShape;
  }, [uiControlShape]);

  useEffect(() => {
    document.documentElement.dataset.readingTone = uiReadingTone;
  }, [uiReadingTone]);

  useEffect(() => {
    const isDark = computedTheme === "dark";
    const tone = READING_TONE_PALETTE[uiReadingTone][isDark ? "dark" : "light"];

    if (isDark) {
      const appLightness = Math.min(20, Math.max(6, tone.app - colorContrastOffset * 0.45));
      const canvasLightness = Math.min(24, Math.max(10, tone.canvas - colorContrastOffset * 0.25));
      const fieldLightness = Math.min(28, Math.max(12, tone.field - colorContrastOffset * 0.18));
      const darkerLightness = Math.min(20, Math.max(8, tone.darker - colorContrastOffset * 0.18));
      document.documentElement.style.setProperty("--bg-app", `hsl(${tone.hue}, ${tone.saturation}%, ${appLightness}%)`);
      document.documentElement.style.setProperty("--bg-canvas", `hsl(${tone.hue}, ${tone.saturation}%, ${canvasLightness}%)`);
      document.documentElement.style.setProperty("--bg-glass", `hsl(${tone.hue}, ${tone.saturation}%, ${canvasLightness}%)`);
      document.documentElement.style.setProperty("--bg-input-field", `hsl(${tone.hue}, ${tone.saturation}%, ${fieldLightness}%)`);
      document.documentElement.style.setProperty("--bg-darker", `hsl(${tone.hue}, ${tone.saturation}%, ${darkerLightness}%)`);
      return;
    }

    const appLightness = Math.min(95, Math.max(84, tone.app - colorContrastOffset));
    const canvasLightness = Math.min(100, Math.max(94, tone.canvas - Math.max(0, colorContrastOffset) * 0.25));
    const fieldLightness = Math.min(100, Math.max(92, tone.field - Math.max(0, colorContrastOffset) * 0.2));
    const darkerLightness = Math.min(96, Math.max(86, tone.darker - Math.max(0, colorContrastOffset) * 0.25));
    document.documentElement.style.setProperty("--bg-app", `hsl(${tone.hue}, ${tone.saturation}%, ${appLightness}%)`);
    document.documentElement.style.setProperty("--bg-canvas", `hsl(${tone.hue}, ${tone.saturation}%, ${canvasLightness}%)`);
    document.documentElement.style.setProperty("--bg-glass", `hsl(${tone.hue}, ${tone.saturation}%, ${fieldLightness}%)`);
    document.documentElement.style.setProperty("--bg-input-field", `hsl(${tone.hue}, ${tone.saturation}%, ${fieldLightness}%)`);
    document.documentElement.style.setProperty("--bg-darker", `hsl(${tone.hue}, ${tone.saturation}%, ${darkerLightness}%)`);
  }, [computedTheme, colorContrastOffset, uiReadingTone]);
}
