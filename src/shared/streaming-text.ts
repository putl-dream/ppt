const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function splitGraphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

export function getTypewriterStepSize(pendingGraphemes: number, streamActive: boolean): number {
  if (pendingGraphemes <= 0) return 0;
  if (!streamActive) return Math.min(32, Math.max(4, Math.ceil(pendingGraphemes / 12)));
  if (pendingGraphemes > 240) return 12;
  if (pendingGraphemes > 96) return 6;
  if (pendingGraphemes > 32) return 3;
  return 1;
}
