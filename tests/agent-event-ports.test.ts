import { describe, expect, it } from "vitest";
import { AgentEventPorts } from "../src/main/agent/runtime/agent-event-ports";

describe("AgentEventPorts renderer adapter", () => {
  it("preserves the renderer DTO shape", () => {
    const received: unknown[] = [];
    const events = new AgentEventPorts({
      threadId: "thread-1",
      appendTranscript: () => undefined,
      onProgress: (event) => received.push(event),
    });
    events.renderer({
      type: "tool-started",
      message: "正在调用工具 ReadPresentationSnapshot...",
      toolName: "ReadPresentationSnapshot",
    });

    expect(received).toEqual([{
      type: "tool-started",
      message: "正在调用工具 ReadPresentationSnapshot...",
      toolName: "ReadPresentationSnapshot",
    }]);
  });

  it("isolates renderer failures and emits a namespaced envelope", () => {
    const events = new AgentEventPorts({
      threadId: "thread-1",
      runId: "run-1",
      appendTranscript: () => undefined,
      onProgress: () => { throw new Error("renderer unavailable"); },
    });

    expect(() => events.renderer({ type: "workflow-progress", message: "working" }))
      .not.toThrow();
    expect(events.envelope("tool", "tool_started", { toolName: "PreviewSlide" }))
      .toMatchObject({
        threadId: "thread-1",
        runId: "run-1",
        namespace: "tool",
        type: "tool_started",
        payload: { toolName: "PreviewSlide" },
      });
  });
});
