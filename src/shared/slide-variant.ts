/**
 * Ephemeral light/dark/hero hint for design-engine resolution only.
 * Not persisted on SVG-native slides (stripped on load; absent from slideSchema).
 */
export const SLIDE_VARIANTS = ["light", "dark", "hero"] as const;
export type SlideVariant = (typeof SLIDE_VARIANTS)[number];
