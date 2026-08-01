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

export interface PresentationSvgMigrationResult {
  value: unknown;
  droppedLegacySlideCount: number;
  strippedLegacyFieldCount: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
 * collision-safe suffixes. Element-id repair is retained only to strip/ignore
 * legacy element arrays during SVG-only migration.
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
  return {
    value,
    repairedSlideIdCount,
    repairedElementIdCount: 0,
  };
}

/**
 * Geometry repair for element-IR is obsolete. Kept as a no-op so call sites
 * continue to compile during the SVG-only cutover.
 */
export function repairPresentationGeometry(
  presentation: unknown,
): PresentationGeometryRepairResult {
  return { value: presentation, repairedDimensionCount: 0 };
}

/**
 * Strip element-IR / Layout Grammar fields and drop slides that are not
 * SVG-native. Product persistence only accepts visualSource.kind === "svg".
 */
export function migratePresentationToSvgOnly(
  presentation: unknown,
): PresentationSvgMigrationResult {
  if (!isRecord(presentation) || !Array.isArray(presentation.slides)) {
    return {
      value: presentation,
      droppedLegacySlideCount: 0,
      strippedLegacyFieldCount: 0,
    };
  }

  const value = structuredClone(presentation);
  if (!isRecord(value) || !Array.isArray(value.slides)) {
    return {
      value: presentation,
      droppedLegacySlideCount: 0,
      strippedLegacyFieldCount: 0,
    };
  }

  let droppedLegacySlideCount = 0;
  let strippedLegacyFieldCount = 0;
  const kept: unknown[] = [];

  for (const slide of value.slides) {
    if (!isRecord(slide)) {
      droppedLegacySlideCount += 1;
      continue;
    }

    const visualSource = isRecord(slide.visualSource) ? slide.visualSource : undefined;
    if (visualSource?.kind !== "svg") {
      droppedLegacySlideCount += 1;
      continue;
    }

    strippedLegacyFieldCount += stripLegacySlideKeys(slide);
    kept.push(slide);
  }

  value.slides = kept;
  return {
    value,
    droppedLegacySlideCount,
    strippedLegacyFieldCount,
  };
}

const LEGACY_SLIDE_KEYS = [
  "elements",
  "layout",
  "grammarVariant",
  "slideVariant",
  "sceneRef",
  "backgroundVariant",
] as const;

function stripLegacySlideKeys(slide: JsonRecord): number {
  let stripped = 0;
  for (const key of LEGACY_SLIDE_KEYS) {
    if (key in slide) {
      delete slide[key];
      stripped += 1;
    }
  }
  return stripped;
}

/**
 * Strip legacy element-IR / Layout Grammar fields from slides embedded inside
 * persisted display cards (review.command-proposal commands + preview), so that
 * Zod strict() validation does not reject cached display state from earlier
 * app versions.
 */
export function migrateDisplayCardsToSvgOnly(
  displayCards: unknown,
): PresentationSvgMigrationResult {
  if (!Array.isArray(displayCards)) {
    return { value: displayCards, droppedLegacySlideCount: 0, strippedLegacyFieldCount: 0 };
  }

  const value = structuredClone(displayCards);
  if (!Array.isArray(value)) {
    return { value: displayCards, droppedLegacySlideCount: 0, strippedLegacyFieldCount: 0 };
  }

  let strippedLegacyFieldCount = 0;

  for (const card of value) {
    if (!isRecord(card)) continue;
    const event = isRecord(card.event) ? card.event : undefined;
    if (!event || event.kind !== "review.command-proposal") continue;
    const payload = isRecord(event.payload) ? event.payload : undefined;
    if (!payload) continue;

    // payload.commands[].slide
    const commands = Array.isArray(payload.commands) ? payload.commands : [];
    for (const cmd of commands) {
      if (!isRecord(cmd)) continue;
      const slide = isRecord(cmd.slide) ? cmd.slide : undefined;
      if (slide) strippedLegacyFieldCount += stripLegacySlideKeys(slide);
    }

    // payload.preview.slides[]
    const preview = isRecord(payload.preview) ? payload.preview : undefined;
    if (preview && Array.isArray(preview.slides)) {
      for (const slide of preview.slides) {
        if (isRecord(slide)) strippedLegacyFieldCount += stripLegacySlideKeys(slide);
      }
    }
  }

  return { value, droppedLegacySlideCount: 0, strippedLegacyFieldCount };
}
