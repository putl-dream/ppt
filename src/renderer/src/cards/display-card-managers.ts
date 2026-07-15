import { create, type StoreApi, type UseBoundStore } from "zustand";
import {
  displayCardActionSchema,
  displayEventSchema,
  persistedDisplayCardSchema,
  type DisplayCardCategory,
  type DisplayCardAction,
  type DisplayCardStatus,
  type DisplayEvent,
  type PersistedDisplayCard,
} from "@shared/card-display-protocol";
import {
  getCardPresentationPolicy,
  type CardPresentationPolicy,
} from "./card-presentation-policy";

export type ManagedDisplayCardStatus = DisplayCardStatus;

export interface ManagedDisplayCard extends PersistedDisplayCard {
  policy: CardPresentationPolicy;
}

interface CategoryCardManagerState {
  cards: ManagedDisplayCard[];
  ingest: (event: DisplayEvent, policy: CardPresentationPolicy) => void;
  setStatus: (
    eventId: string,
    status: ManagedDisplayCardStatus,
    lastAction?: DisplayCardAction,
  ) => void;
  replace: (cards: ManagedDisplayCard[]) => void;
  clear: () => void;
}

type CategoryCardManager = UseBoundStore<StoreApi<CategoryCardManagerState>>;

function sameScope(left: DisplayEvent, right: DisplayEvent): boolean {
  if (left.scope.runId || right.scope.runId) return left.scope.runId === right.scope.runId;
  if (left.scope.threadId || right.scope.threadId) return left.scope.threadId === right.scope.threadId;
  return left.scope.sessionId === right.scope.sessionId;
}

function createCategoryCardManager(category: DisplayCardCategory): CategoryCardManager {
  return create<CategoryCardManagerState>((set) => ({
    cards: [],
    ingest: (event, policy) => set((state) => {
      if (event.category !== category) return state;
      const dedupeKey = policy.dedupeKey(event);
      let matched = false;
      const cards = state.cards.map((card) => {
        const sameCard = card.policy.dedupeKey(card.event) === dedupeKey;
        if (sameCard) {
          matched = true;
          return {
            event,
            policy,
            status: "active" as const,
            receivedAt: Date.now(),
            lastAction: undefined,
          };
        }
        if (
          policy.replaceActiveInScope
          && card.status === "active"
          && sameScope(card.event, event)
        ) {
          return { ...card, status: "superseded" as const };
        }
        return card;
      });

      if (matched) return { cards };
      const next = [
        ...cards,
        { event, policy, status: "active" as const, receivedAt: Date.now() },
      ];
      // Notifications are transient and should not grow without bound.
      return { cards: category === "notification" ? next.slice(-50) : next };
    }),
    setStatus: (eventId, status, lastAction) => set((state) => ({
      cards: state.cards.map((card) =>
        card.event.eventId === eventId
          ? { ...card, status, ...(lastAction ? { lastAction } : {}) }
          : card
      ),
    })),
    replace: (cards) => set({ cards }),
    clear: () => set({ cards: [] }),
  }));
}

// Separate stores intentionally preserve distinct category lifecycles.
export const usePermissionCardManager = createCategoryCardManager("permission");
export const useInteractionCardManager = createCategoryCardManager("interaction");
export const useReviewCardManager = createCategoryCardManager("review");
export const useProgressCardManager = createCategoryCardManager("progress");
export const useArtifactCardManager = createCategoryCardManager("artifact");
export const useNotificationCardManager = createCategoryCardManager("notification");
export const useEnvironmentCardManager = createCategoryCardManager("environment");

const managers: Record<DisplayCardCategory, CategoryCardManager> = {
  permission: usePermissionCardManager,
  interaction: useInteractionCardManager,
  review: useReviewCardManager,
  progress: useProgressCardManager,
  artifact: useArtifactCardManager,
  notification: useNotificationCardManager,
  environment: useEnvironmentCardManager,
};

/** Thin protocol ingress: validate and route, never own category lifecycle. */
export function ingestDisplayEvent(input: unknown): DisplayEvent {
  const event = displayEventSchema.parse(input);
  const policy = getCardPresentationPolicy(event);
  managers[event.category].getState().ingest(event, policy);
  return event;
}

export function setDisplayCardStatus(
  eventId: string,
  status: ManagedDisplayCardStatus,
  lastAction?: DisplayCardAction,
): boolean {
  for (const manager of Object.values(managers)) {
    if (manager.getState().cards.some((card) => card.event.eventId === eventId)) {
      manager.getState().setStatus(eventId, status, lastAction);
      return true;
    }
  }
  return false;
}

export function recordDisplayCardAction(
  eventId: string,
  actionId: DisplayCardAction["actionId"],
  payload: unknown,
  status: ManagedDisplayCardStatus,
): DisplayCardAction | undefined {
  for (const manager of Object.values(managers)) {
    const card = manager.getState().cards.find((item) => item.event.eventId === eventId);
    if (!card) continue;
    const action = displayCardActionSchema.parse({
      protocolVersion: 1,
      eventId,
      actionId,
      payload,
      correlation: {
        sessionId: card.event.scope.sessionId,
        runId: card.event.scope.runId,
        threadId: card.event.scope.threadId,
        toolCallId: card.event.source.kind === "tool"
          ? card.event.source.toolCallId
          : undefined,
      },
    });
    manager.getState().setStatus(eventId, status, action);
    return action;
  }
  return undefined;
}

export function getPersistedDisplayCards(): PersistedDisplayCard[] {
  return Object.values(managers).flatMap((manager) =>
    manager.getState().cards
      .filter((card) => card.policy.persistence === "session")
      .map(({ policy: _policy, ...card }) => persistedDisplayCardSchema.parse(card))
  );
}

export function hydrateDisplayCardManagers(input: PersistedDisplayCard[]): void {
  const grouped: Record<DisplayCardCategory, ManagedDisplayCard[]> = {
    permission: [],
    interaction: [],
    review: [],
    progress: [],
    artifact: [],
    notification: [],
    environment: [],
  };
  for (const rawCard of input) {
    const card = persistedDisplayCardSchema.parse(rawCard);
    const policy = getCardPresentationPolicy(card.event);
    if (policy.persistence !== "session") continue;
    grouped[card.event.category].push({ ...card, policy });
  }
  for (const [category, manager] of Object.entries(managers)) {
    manager.getState().replace(grouped[category as DisplayCardCategory]);
  }
}

export function subscribeDisplayCardManagers(listener: () => void): () => void {
  const unsubscribes = [
    useInteractionCardManager,
    useReviewCardManager,
    useProgressCardManager,
    useArtifactCardManager,
  ].map((manager) => manager.subscribe(listener));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

export function pruneDisplayCardsForMessages(messageIds: ReadonlySet<string>): void {
  for (const manager of Object.values(managers)) {
    const next = manager.getState().cards.filter((card) =>
      !card.event.scope.anchorMessageId || messageIds.has(card.event.scope.anchorMessageId)
    );
    manager.getState().replace(next);
  }
}

export function clearAllDisplayCardManagers(): void {
  for (const manager of Object.values(managers)) manager.getState().clear();
}

export function findActiveToolPermissionCard(
  cards: ManagedDisplayCard[],
  runId?: string | null,
): ManagedDisplayCard | undefined {
  return [...cards].reverse().find((card) =>
    card.status === "active"
    && card.event.kind === "permission.tool-requested"
    && (!runId || card.event.scope.runId === runId)
  );
}
