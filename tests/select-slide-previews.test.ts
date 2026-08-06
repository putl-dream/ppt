import { getCardPresentationPolicy } from "@shared/cards/card-presentation-policy";
import type { ManagedDisplayCard } from "@shared/cards/display-card-managers";
import {
  type SlidePreviewEvent,
  selectLatestSlidePreviews,
} from "@shared/cards/select-slide-previews";
import { describe, expect, it } from "vitest";
import type { DisplayEvent } from "../src/shared/card-display-protocol";

function preview(eventId: string, slideId: string, runId?: string): SlidePreviewEvent {
  return {
    protocolVersion: 1,
    eventId,
    emittedAt: "2026-07-26T00:00:00.000Z",
    kind: "artifact.slide-preview",
    category: "artifact",
    source: { kind: "tool", toolName: "PreviewSvgPage", toolCallId: eventId },
    scope: { sessionId: "session-1", runId },
    semantics: { blocking: false, requiresResponse: false, priority: "normal" },
    payload: {
      slideId,
      title: slideId,
      description: "",
      thumbnail: null,
    },
  };
}

function card(
  event: SlidePreviewEvent,
  receivedAt: number,
  status: ManagedDisplayCard["status"] = "active",
): ManagedDisplayCard {
  return {
    event,
    receivedAt,
    status,
    policy: getCardPresentationPolicy(event),
  };
}

describe("slide preview workspace selection", () => {
  it("keeps only the latest run and the newest screenshot for each page", () => {
    const cards = [
      card(preview("old-1", "slide-1", "run-old"), 1),
      card(preview("new-1a", "slide-1", "run-new"), 2),
      card(preview("new-2", "slide-2", "run-new"), 3),
      card(preview("new-1b", "slide-1", "run-new"), 4),
      card(preview("dismissed", "slide-3", "run-new"), 5, "dismissed"),
    ];

    expect(selectLatestSlidePreviews(cards).map((event) => event.eventId)).toEqual([
      "new-2",
      "new-1b",
    ]);
  });

  it("treats events without a run/thread/message scope as separate batches", () => {
    const cards = [
      card(preview("standalone-1", "slide-1"), 1),
      card(preview("standalone-2", "slide-2"), 2),
    ];

    expect(selectLatestSlidePreviews(cards).map((event) => event.eventId)).toEqual([
      "standalone-2",
    ]);
  });

  it("routes page inspection artifacts to the presentation preview host", () => {
    const event: DisplayEvent = preview("preview-1", "slide-1", "run-1");
    expect(getCardPresentationPolicy(event).host).toBe("presentation-preview");
  });
});
