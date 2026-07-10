import { describe, expect, it } from "vitest";
import { ensureToolResultPairing } from "../src/main/agent/gateway/message-pairing";
import type { AgentModelMessage } from "../src/main/agent/gateway/types";

describe("ensureToolResultPairing", () => {
  it("adds one synthetic error result for every missing tool result", () => {
    const messages: AgentModelMessage[] = [{
      role: "assistant",
      toolCalls: [
        { id: "call-1", name: "Read", args: {} },
        { id: "call-2", name: "List", args: {} },
      ],
    }];

    const repaired = ensureToolResultPairing(messages);

    expect(repaired).toHaveLength(2);
    expect(repaired[1]?.toolResults).toEqual([
      expect.objectContaining({ toolCallId: "call-1", isError: true }),
      expect.objectContaining({ toolCallId: "call-2", isError: true }),
    ]);
  });

  it("removes orphan and duplicate results while preserving call order", () => {
    const messages: AgentModelMessage[] = [
      {
        role: "assistant",
        toolCalls: [
          { id: "call-1", name: "Read", args: {} },
          { id: "call-2", name: "List", args: {} },
        ],
      },
      {
        role: "user",
        toolResults: [
          { toolCallId: "call-2", content: "second" },
          { toolCallId: "call-2", content: "duplicate" },
          { toolCallId: "orphan", content: "orphan" },
          { toolCallId: "call-1", content: "first" },
        ],
      },
      {
        role: "user",
        content: "keep this user message",
        toolResults: [{ toolCallId: "orphan-2", content: "remove" }],
      },
    ];

    const repaired = ensureToolResultPairing(messages);

    expect(repaired[1]?.toolResults).toEqual([
      { toolCallId: "call-1", content: "first" },
      { toolCallId: "call-2", content: "second" },
    ]);
    expect(repaired[2]).toEqual({ role: "user", content: "keep this user message", toolResults: undefined });
  });

  it("does not mutate the caller's message array", () => {
    const messages: AgentModelMessage[] = [{
      role: "user",
      content: "hello",
      toolResults: [{ toolCallId: "orphan", content: "remove" }],
    }];

    ensureToolResultPairing(messages);

    expect(messages[0]?.toolResults).toHaveLength(1);
  });
});
