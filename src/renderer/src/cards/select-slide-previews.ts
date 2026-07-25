import type { DisplayEvent } from "@shared/card-display-protocol";
import type { ManagedDisplayCard } from "./display-card-managers";

export type SlidePreviewEvent = Extract<
  DisplayEvent,
  { kind: "artifact.slide-preview" }
>;

function previewBatchKey(event: SlidePreviewEvent): string {
  return event.scope.runId
    ?? event.scope.threadId
    ?? event.scope.anchorMessageId
    ?? event.eventId;
}

/**
 * The preview workspace shows one coherent inspection pass at a time.
 * Rechecking a page in the same pass replaces its older screenshot.
 */
export function selectLatestSlidePreviews(
  cards: readonly ManagedDisplayCard[],
): SlidePreviewEvent[] {
  const candidates = cards.filter(
    (card): card is ManagedDisplayCard & { event: SlidePreviewEvent } =>
      card.event.kind === "artifact.slide-preview"
      && card.status !== "dismissed"
      && card.status !== "superseded",
  );
  const latest = candidates.reduce<(typeof candidates)[number] | undefined>(
    (current, candidate) =>
      !current || candidate.receivedAt >= current.receivedAt ? candidate : current,
    undefined,
  );
  if (!latest) return [];

  const latestBatchKey = previewBatchKey(latest.event);
  const latestBySlideId = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (previewBatchKey(candidate.event) !== latestBatchKey) continue;
    const previous = latestBySlideId.get(candidate.event.payload.slideId);
    if (!previous || candidate.receivedAt >= previous.receivedAt) {
      latestBySlideId.set(candidate.event.payload.slideId, candidate);
    }
  }

  return [...latestBySlideId.values()]
    .sort((left, right) => left.receivedAt - right.receivedAt)
    .map((card) => card.event);
}

export function getSlidePreviewBatchKey(
  previews: readonly SlidePreviewEvent[],
): string | undefined {
  return previews[0] ? previewBatchKey(previews[0]) : undefined;
}
