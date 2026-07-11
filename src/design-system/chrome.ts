export function resolveChromeTitleFontSize(title: string): number {
  const units = Array.from(title.trim()).reduce(
    (sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 1.8 : 1),
    0,
  );
  if (units > 62) return 24;
  if (units > 50) return 28;
  if (units > 40) return 32;
  return 36;
}
