import type { DesignPalette, DesignTokens } from "./schema";

export interface ResolvedColors {
  bg: string;
  title: string;
  body: string;
  accent: string;
  cardBg: string;
  cardStroke: string;
  muted: string;
  softAccent: string;
}

export const COLOR_SPECS: Record<DesignPalette, ResolvedColors> = {
  "business-blue": { bg: "#f8fbff", title: "#0f172a", body: "#405066", accent: "#2563eb", cardBg: "#ffffff", cardStroke: "#dbeafe", muted: "#eef5ff", softAccent: "#bfdbfe" },
  "warm-paper": { bg: "#fffaf0", title: "#31251b", body: "#66594b", accent: "#b45309", cardBg: "#fff7e6", cardStroke: "#ead7b7", muted: "#f5ead4", softAccent: "#f7d9a8" },
  "mono-report": { bg: "#fafafa", title: "#171717", body: "#525252", accent: "#404040", cardBg: "#ffffff", cardStroke: "#d4d4d4", muted: "#eeeeee", softAccent: "#cfcfcf" },
  "tech-dark": { bg: "#07111f", title: "#eff6ff", body: "#bad3ee", accent: "#22d3ee", cardBg: "#0c1b2d", cardStroke: "#164e63", muted: "#0f2438", softAccent: "#155e75" },
  "soft-academic": { bg: "#f8fbf7", title: "#1f3328", body: "#4b6355", accent: "#2f7d5b", cardBg: "#ffffff", cardStroke: "#d7e6da", muted: "#edf6ee", softAccent: "#c8e6d0" },
};

export function isDarkTokens(tokens: DesignTokens): boolean {
  return tokens.palette === "tech-dark" || tokens.backgroundStyle === "dark";
}

export function resolveColors(tokens: DesignTokens, mode?: "light" | "dark"): ResolvedColors {
  const identity = COLOR_SPECS[tokens.palette];
  const base = mode === "dark"
    ? COLOR_SPECS["tech-dark"]
    : mode === "light"
      ? COLOR_SPECS["business-blue"]
      : identity;
  return {
    ...base,
    accent: identity.accent,
    softAccent: mode == null ? identity.softAccent : base.softAccent,
  };
}
