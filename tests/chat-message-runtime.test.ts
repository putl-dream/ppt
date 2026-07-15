import { describe, expect, it } from "vitest";
import type { PersistedDisplayCard } from "../src/shared/card-display-protocol";
import type { SessionChatMessage } from "../src/shared/session";
import {
  findActiveThreadId,
  toSessionChatMessages,
} from "../src/renderer/src/app/chatMessageRuntime";

function pendingReview(): PersistedDisplayCard {
  return {
    event: {
      protocolVersion: 1,
      eventId: "review-1",
      emittedAt: "2026-07-15T00:00:00.000Z",
      kind: "review.command-proposal",
      category: "review",
      source: { kind: "tool", toolName: "SubmitCommands" },
      scope: { sessionId: "session-1", threadId: "thread-1", anchorMessageId: "a-1" },
      semantics: { blocking: true, requiresResponse: true, priority: "high" },
      payload: {
        threadId: "thread-1",
        summary: "更新排版",
        commands: [],
      },
    },
    status: "active",
    receivedAt: 1,
  };
}

describe("chat message runtime", () => {
  it("finds a recoverable thread when no blocking review card exists", () => {
    const messages: SessionChatMessage[] = [
      { id: "u-1", role: "user", content: "继续" },
      { id: "a-1", role: "assistant", content: "请补充信息", threadId: "thread-1" },
    ];
    expect(findActiveThreadId(messages)).toBe("thread-1");
    expect(findActiveThreadId(messages, [pendingReview()])).toBeUndefined();
  });

  it("persists message content without any card state", () => {
    const messages: SessionChatMessage[] = [
      { id: "u-1", role: "user", content: "生成演示文稿" },
      { id: "a-1", role: "assistant", content: "处理中", threadId: "thread-1" },
    ];
    expect(toSessionChatMessages(messages)).toEqual(messages);
  });
});
