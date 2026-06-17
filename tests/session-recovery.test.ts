import { describe, expect, it } from "vitest";
import { findRecoverableOutlineConversation } from "../src/shared/session-recovery";
import type { SessionChatMessage } from "../src/shared/session";

const outlineRequest = {
  threadId: "thread-1",
  message: "请确认大纲",
  missingInformation: [],
  model: { provider: "anthropic" as const, model: "test-model" },
  executionStrategy: "AUTO" as const,
};

describe("findRecoverableOutlineConversation", () => {
  it("recovers a pending outline even when later turns ended in an app error", () => {
    const messages: SessionChatMessage[] = [
      { id: "init", role: "assistant", content: "welcome" },
      { id: "u1", role: "user", content: "创建 Agent 架构 PPT" },
      { id: "a1", role: "assistant", content: "请确认大纲", outlineRequest },
      { id: "u2", role: "user", content: "Agent 范式与架构演进：从 ReAct / Plan / Workflow 看智能体设计" },
      { id: "a2", role: "assistant", content: "执行指令时发生错误：timeout" },
      { id: "u3", role: "user", content: "我刚才说了什么？" },
    ];

    const recovered = findRecoverableOutlineConversation(messages);

    expect(recovered?.outlineRequest).toBe(outlineRequest);
    expect(recovered?.messages).toEqual([
      { role: "user", content: "创建 Agent 架构 PPT" },
      { role: "assistant", content: "请确认大纲" },
      { role: "user", content: "Agent 范式与架构演进：从 ReAct / Plan / Workflow 看智能体设计" },
      { role: "user", content: "我刚才说了什么？" },
    ]);
  });

  it("does not recover an outline after a terminal assistant response", () => {
    const messages: SessionChatMessage[] = [
      { id: "u1", role: "user", content: "创建 PPT" },
      { id: "a1", role: "assistant", content: "请确认大纲", outlineRequest },
      { id: "a2", role: "assistant", content: "已根据确认的大纲生成排版方案，请审核指令后执行。" },
    ];

    expect(findRecoverableOutlineConversation(messages)).toBeUndefined();
  });
});
