import { describe, expect, it } from "vitest";
import {
  buildAgentRunRequest,
  prepareAgentRunMessages,
} from "../src/renderer/src/app/agent/agentRunPreparation";
import type { ChatMessage } from "../src/renderer/src/app/chatMessageRuntime";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

const sourceMessages: ChatMessage[] = [
  { id: "user-1", role: "user", content: "first" },
  { id: "assistant-1", role: "assistant", content: "answer" },
  { id: "user-2", role: "user", content: "second" },
];

const streamPlaceholder: ChatMessage = {
  id: "stream-1",
  role: "assistant",
  content: "",
  threadId: "run-1",
};

function prepare(overrides: Partial<Parameters<typeof prepareAgentRunMessages>[0]> = {}) {
  return prepareAgentRunMessages({
    sourceMessages,
    activeRequest: "new prompt",
    userDisplayContent: "new prompt",
    isSidechain: false,
    streamPlaceholder,
    createMessageId: () => "new-user-id",
    ...overrides,
  });
}

describe("agent run preparation", () => {
  it("builds the IPC request and includes an optional layout choice", () => {
    const layoutChoice = {
      mode: "creative" as const,
      designSystem: TEST_DESIGN_SYSTEM,
    };
    expect(buildAgentRunRequest({
      prompt: "Create a deck",
      sessionId: "session-1",
      generationMode: "agent",
      layoutChoice,
    })).toEqual({
      prompt: "Create a deck",
      sessionId: "session-1",
      editorContext: { selectedElementIds: [] },
      generationMode: "agent",
      layoutChoice,
    });
  });

  it("appends a visible user message and stream placeholder for a normal send", () => {
    expect(prepare().runMessages.slice(-2)).toEqual([
      { id: "new-user-id", role: "user", content: "new prompt" },
      streamPlaceholder,
    ]);
  });

  it("omits the visible user message for hidden and sidechain turns", () => {
    expect(prepare({ userDisplayContent: null }).runMessages).toEqual([
      ...sourceMessages,
      streamPlaceholder,
    ]);
    expect(prepare({ isSidechain: true }).runMessages).toEqual([
      ...sourceMessages,
      streamPlaceholder,
    ]);
  });

  it("forks at an edited message and reports the retained display-card anchors", () => {
    const result = prepare({ editedMessageId: "user-2", userDisplayContent: "edited" });

    expect(result.forkedMessages).toEqual([
      sourceMessages[0],
      sourceMessages[1],
      { id: "new-user-id", role: "user", content: "edited" },
    ]);
    expect(result.runMessages).toEqual([...result.forkedMessages!, streamPlaceholder]);
    expect([...result.retainedMessageIds!]).toEqual([
      "user-1",
      "assistant-1",
      "new-user-id",
    ]);
    expect(sourceMessages[2]).toEqual({ id: "user-2", role: "user", content: "second" });
  });

  it("keeps the conversation when the edited message no longer exists", () => {
    expect(prepare({ editedMessageId: "missing" })).toEqual({
      runMessages: [...sourceMessages, streamPlaceholder],
    });
  });
});
