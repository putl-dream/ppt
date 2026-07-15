import { beforeEach, describe, expect, it } from "vitest";
import { displayEventSchema } from "../src/shared/card-display-protocol";
import {
  toResultDisplayEvents,
  toStreamDisplayEvent,
} from "../src/main/agent/display/display-event-adapter";
import {
  clearAllDisplayCardManagers,
  findActiveToolPermissionCard,
  ingestDisplayEvent,
  setDisplayCardStatus,
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
      status: "chat",
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
});
