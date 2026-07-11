/** Approximate rendered width of a string in em units (CJK ≈ 1.0, others ≈ 0.55). */
export function estimateTextWidthUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    units += /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch) ? 1.0 : 0.55;
  }
  return units;
}

/**
 * Estimate the largest fontSize (stepping down by 2 from baseSize) at which `text`
 * fits within a boxW × boxH box, honoring explicit newlines. Pure geometry — mirrors
 * the renderers' `line-height: 1.4` + `pre-wrap` behavior; never measures real glyphs.
 */
export function fitFontSize(
  text: string,
  boxW: number,
  boxH: number,
  baseSize: number,
  minSize = 12,
): number {
  if (!text.trim() || boxW <= 0 || boxH <= 0) return baseSize;
  const paragraphs = text.split("\n");
  for (let size = baseSize; size > minSize; size -= 2) {
    const unitsPerLine = boxW / size;
    if (unitsPerLine <= 0) continue;
    const maxLines = Math.max(1, Math.floor(boxH / (size * 1.4)));
    let linesNeeded = 0;
    for (const paragraph of paragraphs) {
      const units = estimateTextWidthUnits(paragraph);
      linesNeeded += Math.max(1, Math.ceil(units / unitsPerLine));
    }
    if (linesNeeded <= maxLines) return size;
  }
  return minSize;
}
