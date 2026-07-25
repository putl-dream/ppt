import { describe, expect, it } from "vitest";
import {
  findRecoverableConversation,
  toAgentMessageHistory,
} from "../src/shared/session-recovery";
import {
  sessionChatMessageSchema,
  type SessionChatMessage,
} from "../src/shared/session";

describe("session run recovery", () => {
  it("excludes failed and interrupted turns by structured status, regardless of copy", () => {
    const messages: SessionChatMessage[] = [
      { id: "init", role: "assistant", content: "welcome" },
      { id: "u1", role: "user", content: "创建产品发布会 PPT" },
      {
        id: "a1",
        role: "assistant",
        content: "这段文本不是错误关键词",
        runStatus: "failed",
        runError: "服务暂时不可用",
      },
      { id: "u2", role: "user", content: "继续" },
    ];

    expect(toAgentMessageHistory(messages, "继续")).toEqual([
      { role: "user", content: "创建产品发布会 PPT" },
    ]);
  });

  it("recovers a thread past a later failed turn without parsing its text", () => {
    const messages: SessionChatMessage[] = [
      { id: "init", role: "assistant", content: "welcome" },
      { id: "u1", role: "user", content: "创建 Agent 架构 PPT" },
      {
        id: "a1",
        role: "assistant",
        content: "请确认大纲",
        runStatus: "waiting",
        threadId: "thread-1",
      },
      { id: "u2", role: "user", content: "强调 ReAct 与 Workflow" },
      {
        id: "a2",
        role: "assistant",
        content: "任意局部输出",
        runStatus: "failed",
        runError: "请求超时",
      },
      { id: "u3", role: "user", content: "继续刚才的内容" },
    ];

    const recovered = findRecoverableConversation(messages);

    expect(recovered?.threadId).toBe("thread-1");
    expect(recovered?.messages).toEqual([
      { role: "user", content: "创建 Agent 架构 PPT" },
      { role: "assistant", content: "请确认大纲" },
      { role: "user", content: "强调 ReAct 与 Workflow" },
      { role: "user", content: "继续刚才的内容" },
    ]);
  });

  it("continues a retryable failed thread from its structural thread id", () => {
    const messages: SessionChatMessage[] = [
      { id: "u1", role: "user", content: "创建 PPT" },
      {
        id: "a1",
        role: "assistant",
        content: "已生成部分内容",
        runStatus: "failed",
        runError: "服务暂时繁忙",
        threadId: "thread-retry",
      },
    ];

    expect(findRecoverableConversation(messages)).toMatchObject({
      threadId: "thread-retry",
      messages: [{ role: "user", content: "创建 PPT" }],
    });
  });

  it("does not recover after a terminal assistant response", () => {
    const messages: SessionChatMessage[] = [
      { id: "u1", role: "user", content: "创建 PPT" },
      {
        id: "a1",
        role: "assistant",
        content: "请确认大纲",
        runStatus: "waiting",
        threadId: "thread-1",
      },
      {
        id: "a2",
        role: "assistant",
        content: "演示文稿已完成",
        runStatus: "completed",
      },
    ];

    expect(findRecoverableConversation(messages)).toBeUndefined();
  });

  it("rejects removed legacy activity fields instead of silently stripping them", () => {
    expect(() => sessionChatMessageSchema.parse({
      id: "a1",
      role: "assistant",
      content: "",
      thought: ["旧思考"],
      reasoning: "旧推理",
      progress: 80,
    })).toThrow();
  });
});
