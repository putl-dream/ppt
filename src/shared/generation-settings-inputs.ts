export const MIN_OUTPUT_TOKENS = 1024;
export const MAX_OUTPUT_TOKENS = 131072;

export function normalizeOutputTokenDraft(value: string, fallback: number): number {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, parsed));
}
