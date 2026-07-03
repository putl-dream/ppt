import { describe, expect, it } from "vitest";
import {
  appendReasoningChunk,
  appendToolStart,
  finishTool,
  markTraceComplete,
  mergeActivityTraces,
  type AgentActivityItem,
} from "../src/shared/agent-activity";

describe("agent activity trace", () => {
  it("keeps the longer trace when merging snapshots", () => {
    const early: AgentActivityItem[] = [
      { id: "1", kind: "step", text: "read", status: "done" },
    ];
    const later: AgentActivityItem[] = [
      { id: "1", kind: "step", text: "read", status: "done" },
      {
        id: "2",
        kind: "tool",
        toolName: "SubmitCommands",
        label: "run",
        status: "done",
        finishedLabel: "done",
      },
    ];

    expect(mergeActivityTraces(early, later)).toEqual(later);
    expect(mergeActivityTraces(later, early)).toEqual(later);
  });

  it("interleaves reasoning and tools without dropping earlier tools", () => {
    let trace: AgentActivityItem[] = [];
    trace = appendReasoningChunk(trace, "plan", 0);
    trace = appendToolStart(trace, "ReadPresentationSnapshot", "read");
    trace = finishTool(trace, "ReadPresentationSnapshot", "read done");
    trace = appendReasoningChunk(trace, "submit", 1);
    trace = appendToolStart(trace, "SubmitCommands", "submit tool");

    expect(trace).toHaveLength(4);
    expect(trace[0]).toMatchObject({ kind: "reasoning", modelStep: 0 });
    expect(trace[1]).toMatchObject({ kind: "tool", toolName: "ReadPresentationSnapshot", status: "done" });
    expect(trace[2]).toMatchObject({ kind: "reasoning", modelStep: 1 });
    expect(trace[3]).toMatchObject({ kind: "tool", toolName: "SubmitCommands", status: "running" });

    trace = finishTool(trace, "SubmitCommands", "submit done");
    trace = markTraceComplete(trace);

    expect(trace[3]).toMatchObject({ kind: "tool", toolName: "SubmitCommands", status: "done" });
  });

  it("does not merge reasoning across different model steps", () => {
    let trace: AgentActivityItem[] = [];
    trace = appendReasoningChunk(trace, "first", 0);
    trace = appendReasoningChunk(trace, "second", 1);

    expect(trace).toHaveLength(2);
    expect(trace[0]).toMatchObject({ kind: "reasoning", content: "first", modelStep: 0, streaming: false });
    expect(trace[1]).toMatchObject({ kind: "reasoning", content: "second", modelStep: 1, streaming: true });
  });

  it("attaches finishedLabel even if tool was prematurely marked done", () => {
    const trace: AgentActivityItem[] = [
      {
        id: "tool-1",
        kind: "tool",
        toolName: "SubmitCommands",
        label: "run",
        status: "done",
      },
    ];

    const finished = finishTool(trace, "SubmitCommands", "done label");
    expect(finished[0]).toMatchObject({
      kind: "tool",
      status: "done",
      finishedLabel: "done label",
    });
  });
});
