import { create, type StoreApi, type UseBoundStore } from "zustand";
import {
  displayEventSchema,
  type DisplayCardCategory,
  type DisplayEvent,
} from "@shared/card-display-protocol";
import {
  getCardPresentationPolicy,
  type CardPresentationPolicy,
} from "./card-presentation-policy";

export type ManagedDisplayCardStatus = "active" | "resolved" | "dismissed" | "superseded";

export interface ManagedDisplayCard {
  event: DisplayEvent;
  policy: CardPresentationPolicy;
  status: ManagedDisplayCardStatus;
  receivedAt: number;
}

interface CategoryCardManagerState {
  cards: ManagedDisplayCard[];
  ingest: (event: DisplayEvent, policy: CardPresentationPolicy) => void;
  setStatus: (eventId: string, status: ManagedDisplayCardStatus) => void;
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
    setStatus: (eventId, status) => set((state) => ({
      cards: state.cards.map((card) =>
        card.event.eventId === eventId ? { ...card, status } : card
      ),
    })),
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
): boolean {
  for (const manager of Object.values(managers)) {
    if (manager.getState().cards.some((card) => card.event.eventId === eventId)) {
      manager.getState().setStatus(eventId, status);
      return true;
    }
  }
  return false;
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
