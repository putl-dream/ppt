import { describe, expect, it } from "vitest";
import {
  hasLayoutCardSinceLastUserMessage,
  visibleLayoutCardMessageIds,
} from "../src/shared/inline-artifact-cards";
import { resolveInlineCardInMessages } from "../src/renderer/src/app/chatMessageRuntime";
import type { SessionChatMessage } from "../src/shared/session";

describe("chat message runtime layout-card policy", () => {
  it("shows only the first layout card in one user turn", () => {
    const messages: SessionChatMessage[] = [
      { id: "user-1", role: "user", content: "生成 PPT" },
      { id: "layout-1", role: "assistant", content: "请选择排版", inlineCards: [{ type: "layout", resolved: "confirmed" }] },
      { id: "layout-2", role: "assistant", content: "请选择排版", inlineCards: [{ type: "layout" }] },
      { id: "user-2", role: "user", content: "新增一页" },
      { id: "layout-3", role: "assistant", content: "请选择排版", inlineCards: [{ type: "layout" }] },
    ];

    expect([...visibleLayoutCardMessageIds(messages)]).toEqual(["layout-1", "layout-3"]);
    expect(hasLayoutCardSinceLastUserMessage(messages, "layout-3")).toBe(false);
    expect(hasLayoutCardSinceLastUserMessage(messages)).toBe(true);
  });

  it("keeps a confirmed layout card when a sidechain uses the updated messages", () => {
    const messages: SessionChatMessage[] = [
      { id: "user-1", role: "user", content: "生成 PPT" },
      { id: "layout-1", role: "assistant", content: "请选择排版", inlineCards: [{ type: "layout" }] },
    ];

    const resolved = resolveInlineCardInMessages(
      messages,
      "layout-1",
      "layout",
      "confirmed",
      "creative",
    );
    const sidechainMessages = [
      ...resolved,
      { id: "sidechain", role: "assistant" as const, content: "" },
    ];

    expect(sidechainMessages[1]?.inlineCards).toEqual([{
      type: "layout",
      resolved: "confirmed",
      layoutMode: "creative",
    }]);
  });

});
