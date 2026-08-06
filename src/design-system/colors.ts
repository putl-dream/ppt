import type {
  ColorOverrides,
  ColorScheme,
  CustomColorScheme,
  DesignPalette,
  DesignTokens,
} from "./schema";

export interface ResolvedColors {
  // Canonical v2 semantic anchors.
  background: string;
  secondaryBg: string;
  primary: string;
  accent: string;
  secondaryAccent: string;
  bodyText: string;
  surface: string;
  grid: string;
  scrim: string;
  // Renderer role projection.
  bg: string;
  title: string;
  body: string;
  cardBg: string;
  cardStroke: string;
  muted: string;
  softAccent: string;
}

export interface ColorSpec {
  background: string;
  secondaryBg: string;
  primary: string;
  accent: string;
  secondaryAccent: string;
  bodyText: string;
  surface: string;
  grid: string;
  scrim: string;
}

/**
 * Named schemes are independent starting points. Visual-style definitions
 * never import or embed these values.
 */
export const COLOR_SPECS: Record<DesignPalette, ColorSpec> = {
  "business-blue": {
    background: "#f8fbff",
    secondaryBg: "#eef5ff",
    primary: "#0f172a",
    accent: "#2563eb",
    secondaryAccent: "#bfdbfe",
    bodyText: "#405066",
    surface: "#ffffff",
    grid: "#dbeafe",
    scrim: "#0f172a",
  },
  "warm-paper": {
    background: "#fffaf0",
    secondaryBg: "#f5ead4",
    primary: "#31251b",
    accent: "#b45309",
    secondaryAccent: "#f7d9a8",
    bodyText: "#66594b",
    surface: "#fff7e6",
    grid: "#ead7b7",
    scrim: "#31251b",
  },
  "mono-report": {
    background: "#fafafa",
    secondaryBg: "#eeeeee",
    primary: "#171717",
    accent: "#404040",
    secondaryAccent: "#cfcfcf",
    bodyText: "#525252",
    surface: "#ffffff",
    grid: "#d4d4d4",
    scrim: "#171717",
  },
  "tech-dark": {
    background: "#07111f",
    secondaryBg: "#0f2438",
    primary: "#eff6ff",
    accent: "#22d3ee",
    secondaryAccent: "#155e75",
    bodyText: "#bad3ee",
    surface: "#0c1b2d",
    grid: "#164e63",
    scrim: "#020617",
  },
  "soft-academic": {
    background: "#f8fbf7",
    secondaryBg: "#edf6ee",
    primary: "#1f3328",
    accent: "#2f7d5b",
    secondaryAccent: "#c8e6d0",
    bodyText: "#4b6355",
    surface: "#ffffff",
    grid: "#d7e6da",
    scrim: "#1f3328",
  },
};

function customSchemeToSpec(scheme: CustomColorScheme): ColorSpec {
  return {
    background: scheme.background,
    secondaryBg: scheme.secondaryBg,
    primary: scheme.primary,
    accent: scheme.accent,
    secondaryAccent: scheme.secondaryAccent,
    bodyText: scheme.bodyText,
    surface: scheme.surface ?? scheme.secondaryBg,
    grid: scheme.grid ?? scheme.secondaryAccent,
    scrim: scheme.scrim ?? scheme.primary,
  };
}

function resolveSpec(scheme: ColorScheme): ColorSpec {
  return typeof scheme === "string" ? COLOR_SPECS[scheme] : customSchemeToSpec(scheme);
}

function hexLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function isDarkColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color) && hexLuminance(color) < 0.22;
}

export function isDarkColorScheme(scheme: ColorScheme): boolean {
  return isDarkColor(resolveSpec(scheme).background);
}

export function isDarkTokens(tokens: DesignTokens): boolean {
  return tokens.palette === "tech-dark" || tokens.backgroundStyle === "dark";
}

function adaptSurface(base: ColorSpec, mode: "light" | "dark"): ColorSpec {
  const alreadyDark = isDarkColor(base.background);
  if ((mode === "dark") === alreadyDark) return base;
  const surface = mode === "dark" ? COLOR_SPECS["tech-dark"] : COLOR_SPECS["business-blue"];
  return {
    ...surface,
    // Preserve the selected scheme's brand identity across surface variants.
    accent: base.accent,
    secondaryAccent: base.secondaryAccent,
  };
}

function applyAnchorOverrides(base: ColorSpec, overrides?: ColorOverrides): ColorSpec {
  if (!overrides) return base;
  return {
    background: overrides.background ?? overrides.bg ?? base.background,
    secondaryBg:
      overrides.secondaryBg ?? overrides.secondaryBackground ?? overrides.muted ?? base.secondaryBg,
    primary: overrides.primary ?? overrides.title ?? base.primary,
    accent: overrides.accent ?? base.accent,
    secondaryAccent: overrides.secondaryAccent ?? overrides.softAccent ?? base.secondaryAccent,
    bodyText: overrides.bodyText ?? overrides.body ?? base.bodyText,
    surface: overrides.surface ?? overrides.cardBg ?? base.surface,
    grid: overrides.grid ?? overrides.cardStroke ?? base.grid,
    scrim: overrides.scrim ?? base.scrim,
  };
}

export function resolveColors(
  schemeOrTokens: ColorScheme | DesignTokens,
  mode?: "light" | "dark",
  overrides?: ColorOverrides,
): ResolvedColors {
  const scheme: ColorScheme =
    typeof schemeOrTokens === "object" && "palette" in schemeOrTokens
      ? schemeOrTokens.palette
      : schemeOrTokens;
  const source = resolveSpec(scheme);
  const adapted = mode ? adaptSurface(source, mode) : source;
  const colors = applyAnchorOverrides(adapted, overrides);
  return {
    ...colors,
    bg: colors.background,
    title: colors.primary,
    body: colors.bodyText,
    cardBg: colors.surface,
    cardStroke: colors.grid,
    muted: colors.secondaryBg,
    softAccent: colors.secondaryAccent,
  };
}
