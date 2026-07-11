type JsonRecord = Record<string, unknown>;

export interface PresentationGeometryRepairResult {
  value: unknown;
  repairedDimensionCount: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function minimumDimension(element: JsonRecord, field: "width" | "height"): number {
  if (field === "height" && element.type === "text") return 16;
  return 1;
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
