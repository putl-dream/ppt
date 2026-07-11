/** Fit a one-line slide chrome title consistently across all renderers. */
export function resolveChromeTitleFontSize(title: string): number {
  const widthUnits = Array.from(title.trim()).reduce(
    (sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 1.8 : 1),
    0,
  );
  if (widthUnits > 62) return 24;
  if (widthUnits > 50) return 28;
  if (widthUnits > 40) return 32;
  return 36;
}
