import type {
  DisplayCardCategory,
  DisplayEvent,
  DisplayEventKind,
} from "@shared/card-display-protocol";

export type CardHostId =
  | "composer-overlay"
  | "composer-before-input"
  | "timeline"
  | "workspace"
  | "global-notification"
  | "environment-preflight";

export interface CardPresentationPolicy {
  category: DisplayCardCategory;
  host: CardHostId;
  activation: "immediate" | "stream-ended" | "domain-ready";
  persistence: "volatile" | "session" | "derived";
  replaceActiveInScope?: boolean;
  dedupeKey: (event: DisplayEvent) => string;
}

const scopeKey = (event: DisplayEvent) =>
  event.scope.runId ?? event.scope.threadId ?? event.scope.sessionId ?? "global";

export const CARD_PRESENTATION_POLICIES: Record<DisplayEventKind, CardPresentationPolicy> = {
  "permission.tool-requested": {
    category: "permission",
    host: "composer-overlay",
    activation: "immediate",
    persistence: "volatile",
    replaceActiveInScope: true,
    dedupeKey: (event) => event.eventId,
  },
  "interaction.question-requested": {
    category: "interaction",
    host: "timeline",
    activation: "stream-ended",
    persistence: "session",
    dedupeKey: (event) => event.eventId,
  },
  "interaction.layout-required": {
    category: "interaction",
    host: "composer-before-input",
    activation: "domain-ready",
    persistence: "session",
    replaceActiveInScope: true,
    dedupeKey: (event) => `${event.kind}:${event.scope.sessionId ?? scopeKey(event)}`,
  },
  "review.command-proposal": {
    category: "review",
    host: "timeline",
    activation: "stream-ended",
    persistence: "session",
    dedupeKey: (event) => event.eventId,
  },
  "review.patch-ready": {
    category: "review",
    host: "timeline",
    activation: "domain-ready",
    persistence: "session",
    dedupeKey: (event) => event.eventId,
  },
  "progress.task-graph-updated": {
    category: "progress",
    host: "composer-before-input",
    activation: "immediate",
    persistence: "session",
    replaceActiveInScope: true,
    dedupeKey: (event) => `${event.kind}:${event.scope.sessionId ?? scopeKey(event)}`,
  },
  "artifact.ready": {
    category: "artifact",
    host: "timeline",
    activation: "domain-ready",
    persistence: "session",
    dedupeKey: (event) => {
      if (event.kind !== "artifact.ready") return event.eventId;
      return `artifact:${event.payload.artifactId}`;
    },
  },
  "notification.message": {
    category: "notification",
    host: "global-notification",
    activation: "immediate",
    persistence: "volatile",
    dedupeKey: (event) => event.eventId,
  },
  "environment.action-required": {
    category: "environment",
    host: "environment-preflight",
    activation: "immediate",
    persistence: "derived",
    replaceActiveInScope: true,
    dedupeKey: (event) => {
      if (event.kind !== "environment.action-required") return event.eventId;
      return `environment:${event.payload.code}:${scopeKey(event)}`;
    },
  },
};

/** Tool bindings are semantic defaults, not a one-tool/one-card restriction. */
export const TOOL_DISPLAY_BINDINGS: Readonly<Record<string, readonly DisplayEventKind[]>> = {
  AskUser: ["interaction.question-requested"],
  SubmitCommands: ["review.command-proposal"],
  TaskGraphCreate: ["progress.task-graph-updated"],
  TaskGraphUpdate: ["progress.task-graph-updated"],
  TaskGraphClaim: ["progress.task-graph-updated"],
  TaskGraphSubmit: ["progress.task-graph-updated"],
  TaskGraphComplete: ["progress.task-graph-updated"],
};

export function getCardPresentationPolicy(event: DisplayEvent): CardPresentationPolicy {
  const policy = CARD_PRESENTATION_POLICIES[event.kind];
  if (policy.category !== event.category) {
    throw new Error(
      `Display event category mismatch for ${event.kind}: expected ${policy.category}, got ${event.category}`,
    );
  }
  return policy;
}
