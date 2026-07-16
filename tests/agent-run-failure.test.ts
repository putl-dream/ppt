import { describe, expect, it, vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import { handleAgentRunFailure } from "../src/renderer/src/app/agent/agentRunFailure";
import type { ChatMessage } from "../src/renderer/src/app/chatMessageRuntime";

function createMessageState(initial: ChatMessage[]) {
  let messages = initial;
  const setMessages: Dispatch<SetStateAction<ChatMessage[]>> = (action) => {
    messages = typeof action === "function" ? action(messages) : action;
  };
  return {
    get messages() {
      return messages;
    },
    setMessages,
  };
}

describe("handleAgentRunFailure", () => {
  it("marks an interrupted streamed response without discarding partial content", () => {
    const state = createMessageState([
      {
        id: "assistant-1",
        role: "assistant",
        content: "已生成部分内容",
      },
    ]);
    const notify = vi.fn();

    handleAgentRunFailure({
      error: new Error("aborted by user"),
      isSidechain: false,
      runMessageId: "assistant-1",
      activeTrace: [
        {
          id: "step-1",
          kind: "step",
          text: "处理中",
          status: "running",
        },
      ],
      setChatMessages: state.setMessages,
      notify,
    });

    expect(state.messages[0]?.content).toContain("已生成部分内容");
    expect(state.messages[0]?.content).toContain("会话已中断");
    expect(state.messages[0]?.activityTrace?.[0]).toMatchObject({ status: "done" });
    expect(notify).toHaveBeenCalledWith("会话已中断");
  });

  it("writes a public failure message for foreground runs", () => {
    const state = createMessageState([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
      },
    ]);

    handleAgentRunFailure({
      error: new Error("unexpected tool error"),
      isSidechain: false,
      runMessageId: "assistant-1",
      activeTrace: [],
      setChatMessages: state.setMessages,
      notify: vi.fn(),
    });

    expect(state.messages[0]?.content).toContain("本次处理未完成");
    expect(state.messages[0]?.content).toContain("处理请求时遇到问题，请稍后重试");
  });

  it("does not append a visible failure message for sidechain runs", () => {
    const state = createMessageState([]);

    handleAgentRunFailure({
      error: new Error("background failure"),
      isSidechain: true,
      runMessageId: undefined,
      activeTrace: [],
      setChatMessages: state.setMessages,
      notify: vi.fn(),
    });

    expect(state.messages).toEqual([]);
  });
});
