import type { TextElement } from "./presentation";

export const TEXT_ROLES = ["kicker", "body", "metric", "caption"] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

export const FONT_FAMILIES = ["serif", "sans", "mono"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

/** Resolve element font from explicit fontFamily, textRole, and deck theme. */
export function resolveFontFamily(
  fontFamily: FontFamily | undefined,
  textRole: TextRole | undefined,
  theme: string,
): FontFamily {
  if (fontFamily) return fontFamily;

  if (textRole === "metric") {
    return theme === "midnight" ? "mono" : "sans";
  }
  if (textRole === "caption" || textRole === "kicker") {
    return theme === "midnight" ? "mono" : "sans";
  }
  if (textRole === "body") {
    return "sans";
  }

  switch (theme) {
    case "nordic":
    case "sunset":
      return "serif";
    case "midnight":
      return "mono";
    default:
      return "sans";
  }
}

export function resolveElementFontFamily(element: TextElement, theme: string): FontFamily {
  return resolveFontFamily(element.fontFamily, element.textRole, theme);
}

export function fontFamilyToCss(family: FontFamily): string {
  switch (family) {
    case "serif":
      return 'Georgia, "Times New Roman", serif';
    case "mono":
      return '"JetBrains Mono", "Courier New", monospace';
    case "sans":
      return '"Inter", "Outfit", sans-serif';
  }
}

export function fontFamilyToPptxFace(family: FontFamily): string {
  switch (family) {
    case "serif":
      return "Georgia";
    case "mono":
      return "Courier New";
    case "sans":
      return "Arial";
  }
}

/** Cover/section hero titles: serif on magazine themes, sans on data-driven themes. */
export function resolveCoverTitleFont(theme: string): FontFamily {
  return theme === "nordic" || theme === "sunset" ? "serif" : "sans";
}
