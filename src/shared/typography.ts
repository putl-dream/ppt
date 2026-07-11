import type { TextElement } from "./presentation";

export const TEXT_ROLES = ["kicker", "body", "metric", "caption"] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

export const FONT_FAMILIES = ["serif", "sans", "mono"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

/** Resolve element font from explicit fontFamily, textRole, and resolved deck typography. */
export function resolveFontFamily(
  fontFamily: FontFamily | undefined,
  textRole: TextRole | undefined,
  fallback: FontFamily = "sans",
): FontFamily {
  if (fontFamily) return fontFamily;

  if (textRole === "metric") {
    return fallback === "mono" ? "mono" : "sans";
  }
  if (textRole === "caption" || textRole === "kicker") {
    return fallback === "mono" ? "mono" : "sans";
  }
  if (textRole === "body") {
    return "sans";
  }

  return fallback;
}

export function resolveElementFontFamily(element: TextElement, fallback: FontFamily = "sans"): FontFamily {
  return resolveFontFamily(element.fontFamily, element.textRole, fallback);
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

