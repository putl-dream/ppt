type JsonRecord = Record<string, unknown>;

export interface PresentationGeometryRepairResult {
  value: unknown;
  repairedDimensionCount: number;
}

export interface PresentationIdentityRepairResult {
  value: unknown;
  repairedSlideIdCount: number;
  repairedElementIdCount: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minimumDimension(element: JsonRecord, field: "width" | "height"): number {
  if (field === "height" && element.type === "text") return 16;
  return 1;
}

function repairDuplicateRecordIds(records: unknown[]): number {
  const reservedIds = new Set(
    records
      .filter(isRecord)
      .map((record) => record.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const usedIds = new Set<string>();
  const nextOrdinalById = new Map<string, number>();
  let repairedCount = 0;

  for (const record of records) {
    if (!isRecord(record) || typeof record.id !== "string") continue;
    const originalId = record.id;
    if (!usedIds.has(originalId)) {
      usedIds.add(originalId);
      continue;
    }

    let ordinal = nextOrdinalById.get(originalId) ?? 2;
    let candidate = `${originalId}__duplicate_${ordinal}`;
    while (reservedIds.has(candidate) || usedIds.has(candidate)) {
      ordinal += 1;
      candidate = `${originalId}__duplicate_${ordinal}`;
    }

    record.id = candidate;
    usedIds.add(candidate);
    nextOrdinalById.set(originalId, ordinal + 1);
    repairedCount += 1;
  }

  return repairedCount;
}

/**
 * Migrates legacy presentations that predate identity validation. The first
 * occurrence keeps its original ID; later duplicates receive deterministic,
 * collision-safe suffixes while all slide and element content is preserved.
 * Malformed or missing IDs remain untouched so the canonical schema rejects
 * them after migration.
 */
export function repairPresentationIdentities(
  presentation: unknown,
): PresentationIdentityRepairResult {
  if (!isRecord(presentation) || !Array.isArray(presentation.slides)) {
    return {
      value: presentation,
      repairedSlideIdCount: 0,
      repairedElementIdCount: 0,
    };
  }

  const value = structuredClone(presentation);
  if (!isRecord(value) || !Array.isArray(value.slides)) {
    return {
      value: presentation,
      repairedSlideIdCount: 0,
      repairedElementIdCount: 0,
    };
  }

  const repairedSlideIdCount = repairDuplicateRecordIds(value.slides);
  let repairedElementIdCount = 0;
  for (const slide of value.slides) {
    if (!isRecord(slide) || !Array.isArray(slide.elements)) continue;
    repairedElementIdCount += repairDuplicateRecordIds(slide.elements);
  }

  return {
    value,
    repairedSlideIdCount,
    repairedElementIdCount,
  };
}

/**
 * Repairs only the known persisted-geometry corruption case: finite numeric
 * dimensions that are zero or negative. Missing, non-numeric, and otherwise
 * malformed fields remain untouched so the canonical schema still rejects them.
 */
export function repairPresentationGeometry(
  presentation: unknown,
): PresentationGeometryRepairResult {
  if (!isRecord(presentation) || !Array.isArray(presentation.slides)) {
    return { value: presentation, repairedDimensionCount: 0 };
  }

  const value = structuredClone(presentation);
  if (!isRecord(value) || !Array.isArray(value.slides)) {
    return { value: presentation, repairedDimensionCount: 0 };
  }

  let repairedDimensionCount = 0;
  for (const slide of value.slides) {
    if (!isRecord(slide) || !Array.isArray(slide.elements)) continue;
    for (const element of slide.elements) {
      if (!isRecord(element)) continue;
      for (const field of ["width", "height"] as const) {
        const dimension = element[field];
        if (typeof dimension !== "number" || !Number.isFinite(dimension) || dimension > 0) {
          continue;
        }
        element[field] = minimumDimension(element, field);
        repairedDimensionCount += 1;
      }
    }
  }

  return { value, repairedDimensionCount };
}
