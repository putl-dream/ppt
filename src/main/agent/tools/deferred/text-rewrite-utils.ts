const PROTECTED_FACT_PATTERN =
  /https?:\/\/[^\s，。；、！？）)]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:[$¥€£]\s*)?[+-]?\d[\d,]*(?:\.\d+)?%?/g;

function normalizeProtectedFact(value: string): string {
  return value
    .trim()
    .replace(/[，,]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function extractProtectedFacts(text: string): string[] {
  return [
    ...new Set(
      (text.match(PROTECTED_FACT_PATTERN) ?? [])
        .map(normalizeProtectedFact)
        .filter(Boolean),
    ),
  ];
}

export function assertProtectedFactsPreserved(
  source: string,
  candidate: string,
): void {
  const normalizedCandidate = normalizeProtectedFact(candidate);
  const missing = extractProtectedFacts(source).filter(
    (fact) => !normalizedCandidate.includes(fact),
  );
  if (missing.length > 0) {
    throw new Error(
      `Rewritten text dropped protected factual tokens: ${missing.join(", ")}.`,
    );
  }
}
