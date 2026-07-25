import { beforeEach, describe, expect, it } from "vitest";
import { displayEventSchema } from "../src/shared/card-display-protocol";
import {
  toResultDisplayEvents,
  toStreamDisplayEvent,
} from "../src/main/agent/display/display-event-adapter";
import {
  clearAllDisplayCardManagers,
  findActiveToolPermissionCard,
  getPersistedDisplayCards,
  hydrateDisplayCardManagers,
  ingestDisplayEvent,
  recordDisplayCardAction,
  setDisplayCardStatus,
  useInteractionCardManager,
  usePermissionCardManager,
  useProgressCardManager,
} from "../src/renderer/src/cards/display-card-managers";
import { getCardPresentationPolicy } from "../src/renderer/src/cards/card-presentation-policy";

const permissionEvent = {
  protocolVersion: 1 as const,
  eventId: "tool-approval:approval-1",
  emittedAt: "2026-07-15T00:00:00.000Z",
  kind: "permission.tool-requested" as const,
  category: "permission" as const,
  source: { kind: "tool" as const, toolName: "ExportPptx" },
  scope: { sessionId: "session-1", runId: "run-1" },
  semantics: {
    blocking: true,
    requiresResponse: true,
    priority: "critical" as const,
  },
  payload: {
    approvalId: "approval-1",
    toolName: "ExportPptx",
    reason: "需要写入导出文件",
    detail: "output.pptx",
  },
};

describe("card display protocol", () => {
  beforeEach(() => clearAllDisplayCardManagers());

  it("validates semantic events and keeps placement in renderer policy", () => {
    const event = displayEventSchema.parse(permissionEvent);
    const policy = getCardPresentationPolicy(event);

    expect(policy.host).toBe("composer-overlay");
    expect(policy.persistence).toBe("volatile");
    expect(event).not.toHaveProperty("component");
    expect(event).not.toHaveProperty("placement");
  });

  it("rejects a kind/category mismatch at the protocol boundary", () => {
    expect(() => displayEventSchema.parse({
      ...permissionEvent,
      category: "notification",
    })).toThrow();
  });

  it("routes permission events to an independent blocking manager", () => {
    ingestDisplayEvent(permissionEvent);
    const cards = usePermissionCardManager.getState().cards;
    const active = findActiveToolPermissionCard(cards, "run-1");

    expect(active?.event.kind).toBe("permission.tool-requested");
    expect(useProgressCardManager.getState().cards).toHaveLength(0);
    expect(setDisplayCardStatus(permissionEvent.eventId, "resolved")).toBe(true);
    expect(findActiveToolPermissionCard(usePermissionCardManager.getState().cards, "run-1"))
      .toBeUndefined();
  });

  it("adapts runtime events and terminal results without naming React components", () => {
    const streamDisplay = toStreamDisplayEvent({
      type: "tool-approval-waiting",
      message: "等待授权",
      approvalId: "approval-2",
      toolName: "RewriteSlideContent",
      reason: "将修改演示文稿内容",
      detail: "slide-2",
    }, "session-1", "run-2");

    expect(streamDisplay?.kind).toBe("permission.tool-requested");
    expect(streamDisplay?.scope.runId).toBe("run-2");

    const resultEvents = toResultDisplayEvents({
      status: "waiting-user",
      message: "请选择内容侧重点",
      threadId: "thread-1",
      question: {
        variant: "choices",
        selectionMode: "single",
        options: [{ id: "practice", title: "实践案例" }],
      },
    }, "session-1", "run-2");

    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0]?.kind).toBe("interaction.question-requested");
    expect(resultEvents[0]?.scope.threadId).toBe("thread-1");
  });

  it("persists manager status and actions independently from chat messages", () => {
    const event = toResultDisplayEvents({
      status: "waiting-user",
      message: "请选择内容侧重点",
      threadId: "thread-1",
      question: {
        variant: "choices",
        selectionMode: "single",
        options: [{ id: "practice", title: "实践案例" }],
      },
    }, "session-1", "run-2")[0]!;
    ingestDisplayEvent({ ...event, scope: { ...event.scope, anchorMessageId: "message-1" } });
    recordDisplayCardAction(event.eventId, "answer", {
      optionIds: ["practice"],
      value: "practice",
      label: "实践案例",
    }, "resolved");

    const snapshot = getPersistedDisplayCards();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.status).toBe("resolved");
    expect(snapshot[0]?.lastAction?.actionId).toBe("answer");

    clearAllDisplayCardManagers();
    hydrateDisplayCardManagers(snapshot);
    expect(useInteractionCardManager.getState().cards[0]?.lastAction?.payload).toMatchObject({
      value: "practice",
    });
  });

  it("does not reopen a resolved layout card when the same event is delivered again", () => {
    const event = {
      protocolVersion: 1 as const,
      eventId: "layout-required:session-1:4",
      emittedAt: "2026-07-15T00:00:00.000Z",
      kind: "interaction.layout-required" as const,
      category: "interaction" as const,
      source: {
        kind: "domain" as const,
        entityType: "presentation",
        entityId: "session-1",
        revision: 4,
      },
      scope: { sessionId: "session-1", runId: "run-4" },
      semantics: {
        blocking: true,
        requiresResponse: true,
        priority: "high" as const,
      },
      payload: {
        presentationRevision: 4,
        slideCount: 8,
      },
    };

    ingestDisplayEvent(event);
    recordDisplayCardAction(
      event.eventId,
      "confirm-layout",
      { mode: "template" },
      "resolved",
    );
    ingestDisplayEvent({
      ...event,
      scope: { ...event.scope, anchorMessageId: "message-4" },
    });

    const [card] = useInteractionCardManager.getState().cards;
    expect(card?.status).toBe("resolved");
    expect(card?.lastAction?.actionId).toBe("confirm-layout");
    expect(card?.event.scope.anchorMessageId).toBe("message-4");
  });

  it("keeps a confirmed layout choice terminal across later presentation revisions", () => {
    const event = {
      protocolVersion: 1 as const,
      eventId: "layout-required:session-1:4",
      emittedAt: "2026-07-15T00:00:00.000Z",
      kind: "interaction.layout-required" as const,
      category: "interaction" as const,
      source: {
        kind: "domain" as const,
        entityType: "presentation",
        entityId: "session-1",
        revision: 4,
      },
      scope: {
        sessionId: "session-1",
        runId: "run-4",
        anchorMessageId: "message-4",
      },
      semantics: {
        blocking: true,
        requiresResponse: true,
        priority: "high" as const,
      },
      payload: {
        presentationRevision: 4,
        slideCount: 8,
      },
    };

    ingestDisplayEvent(event);
    recordDisplayCardAction(
      event.eventId,
      "confirm-layout",
      { mode: "template" },
      "resolved",
    );

    const persisted = getPersistedDisplayCards();
    clearAllDisplayCardManagers();
    hydrateDisplayCardManagers(persisted);
    ingestDisplayEvent({
      ...event,
      eventId: "layout-required:session-1:5",
      source: { ...event.source, revision: 5 },
      scope: {
        ...event.scope,
        runId: "run-5",
        anchorMessageId: "message-5",
      },
      payload: {
        presentationRevision: 5,
        slideCount: 8,
      },
    });

    const [card] = useInteractionCardManager.getState().cards;
    expect(card?.status).toBe("resolved");
    expect(card?.event.eventId).toBe(event.eventId);
    expect(card?.event.scope.anchorMessageId).toBe("message-4");
    expect(card?.lastAction?.actionId).toBe("confirm-layout");
  });

  it("keeps the complete approval request in the review event payload", () => {
    const [event] = toResultDisplayEvents({
      status: "approval-required",
      approval: {
        threadId: "thread-review",
        summary: "更新标题",
        commands: [{ id: "command-1", type: "set-presentation-title", title: "新标题" }],
        assumptions: ["保留现有页面"],
      },
    }, "session-1", "run-3");

    expect(event?.kind).toBe("review.command-proposal");
    if (event?.kind !== "review.command-proposal") throw new Error("missing review event");
    expect(event.payload.threadId).toBe("thread-review");
    expect(event.payload.commands).toHaveLength(1);
  });
});
