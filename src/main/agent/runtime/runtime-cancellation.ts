export function isRuntimeCancellation(
  error: unknown,
  ...signals: Array<AbortSignal | undefined>
): boolean {
  if (signals.some((signal) => signal?.aborted)) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR";
}

export function rethrowIfRuntimeCancellation(
  error: unknown,
  ...signals: Array<AbortSignal | undefined>
): void {
  if (isRuntimeCancellation(error, ...signals)) throw error;
}
