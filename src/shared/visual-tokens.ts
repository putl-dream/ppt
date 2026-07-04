import type { ShapeElement } from "./presentation";
import type { BackgroundGradient } from "./slide-background";

/** Shared visual vocabulary tokens for layouts and style strategies. */
export const VISUAL_TOKENS = {
  radii: {
    sm: 6,
    md: 12,
    lg: 20,
    pill: 999,
  },
  elevation: {
    none: undefined,
    sm: {
      color: "#000000",
      blur: 8,
      offsetX: 0,
      offsetY: 2,
      opacity: 0.06,
    },
    md: {
      color: "#000000",
      blur: 16,
      offsetX: 0,
      offsetY: 4,
      opacity: 0.1,
    },
    lg: {
      color: "#000000",
      blur: 24,
      offsetX: 0,
      offsetY: 8,
      opacity: 0.14,
    },
  },
} as const;

export type ElevationLevel = keyof typeof VISUAL_TOKENS.elevation;

export function cardShadow(level: ElevationLevel = "md"): ShapeElement["shadow"] {
  return VISUAL_TOKENS.elevation[level];
}

export function heroGradient(from: string, to: string, angle = 135): BackgroundGradient {
  return {
    type: "linear",
    angle,
    stops: [
      { color: from, pos: 0 },
      { color: to, pos: 100 },
    ],
  };
}
