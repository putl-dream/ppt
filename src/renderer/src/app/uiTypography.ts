export type UiFontFamily = "system" | "yahei" | "pingfang" | "segoe";

export const DEFAULT_UI_FONT_FAMILY: UiFontFamily = "system";
/** Base UI size in px; matches --text-base in tokens/typography.css. */
export const DEFAULT_UI_FONT_SIZE = 13;
/** Base leading multiplier; --text-base-lh (21px) is ~1.6x of 13px. */
export const DEFAULT_UI_LINE_HEIGHT = 1.6;

export const MIN_UI_FONT_SIZE = 11;
export const MAX_UI_FONT_SIZE = 20;
export const MIN_UI_LINE_HEIGHT = 1.2;
export const MAX_UI_LINE_HEIGHT = 2.2;

const SYSTEM_FONT_STACK =
  'system-ui, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif';

const FONT_FAMILY_STACKS: Record<UiFontFamily, { display: string; body: string }> = {
  system: {
    display: SYSTEM_FONT_STACK,
    body: SYSTEM_FONT_STACK,
  },
  yahei: {
    display: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif',
    body: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif',
  },
  pingfang: {
    display: '"PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
    body: '"PingFang SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif',
  },
  segoe: {
    display: '"Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif',
    body: '"Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif',
  },
};

/**
 * Default scale from tokens/typography.css, in px. Each step keeps its own
 * leading character (badges stay tight, prose stays loose); the settings values
 * scale the whole table rather than flattening it to one ratio.
 */
const DEFAULT_TEXT_SCALE: Array<{ name: string; size: number; lineHeight: number }> = [
  { name: "2xs", size: 10, lineHeight: 14 },
  { name: "xs", size: 11, lineHeight: 16 },
  { name: "sm", size: 12, lineHeight: 19 },
  { name: "base", size: 13, lineHeight: 21 },
  { name: "md", size: 14, lineHeight: 23 },
  { name: "lg", size: 16, lineHeight: 26 },
  { name: "xl", size: 20, lineHeight: 30 },
  { name: "2xl", size: 24, lineHeight: 34 },
];

const FONT_FAMILY_VARS = ["--font-display", "--font-body"] as const;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePersistedUiFontFamily(value: unknown): UiFontFamily {
  if (value === "yahei" || value === "pingfang" || value === "segoe" || value === "system") {
    return value;
  }
  return DEFAULT_UI_FONT_FAMILY;
}

export function normalizePersistedUiFontSize(value: unknown): number {
  const size = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(size)) return DEFAULT_UI_FONT_SIZE;
  return round1(clamp(size, MIN_UI_FONT_SIZE, MAX_UI_FONT_SIZE));
}

export function normalizePersistedUiLineHeight(value: unknown): number {
  const lineHeight = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(lineHeight)) return DEFAULT_UI_LINE_HEIGHT;
  return round1(clamp(lineHeight, MIN_UI_LINE_HEIGHT, MAX_UI_LINE_HEIGHT));
}

/**
 * Writes font/size CSS variables as inline styles on :root.
 * Default values remove the inline overrides so stylesheet tokens take over again.
 */
export function applyUiTypography(
  family: UiFontFamily,
  fontSize: number,
  lineHeight: number,
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  if (family === DEFAULT_UI_FONT_FAMILY) {
    for (const name of FONT_FAMILY_VARS) {
      root.style.removeProperty(name);
    }
  } else {
    const stacks = FONT_FAMILY_STACKS[family];
    root.style.setProperty("--font-display", stacks.display);
    root.style.setProperty("--font-body", stacks.body);
  }

  const isDefaultScale =
    fontSize === DEFAULT_UI_FONT_SIZE && lineHeight === DEFAULT_UI_LINE_HEIGHT;

  if (isDefaultScale) {
    for (const step of DEFAULT_TEXT_SCALE) {
      root.style.removeProperty(`--text-${step.name}`);
      root.style.removeProperty(`--text-${step.name}-lh`);
    }
    return;
  }

  const sizeScale = fontSize / DEFAULT_UI_FONT_SIZE;
  const leadingScale = lineHeight / DEFAULT_UI_LINE_HEIGHT;

  for (const step of DEFAULT_TEXT_SCALE) {
    root.style.setProperty(`--text-${step.name}`, `${round1(step.size * sizeScale)}px`);
    root.style.setProperty(
      `--text-${step.name}-lh`,
      `${round1(step.lineHeight * sizeScale * leadingScale)}px`,
    );
  }
}
