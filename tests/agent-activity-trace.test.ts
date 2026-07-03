import { describe, expect, it } from "vitest";
import {
  appendReasoningChunk,
  appendToolStart,
  finishTool,
  markTraceComplete,
  preferActivityTrace,
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

    expect(preferActivityTrace(early, later)).toEqual(later);
    expect(preferActivityTrace(later, early)).toEqual(later);
  });

  it("interleaves reasoning and tools without dropping earlier tools", () => {
    let trace: AgentActivityItem[] = [];
    trace = appendReasoningChunk(trace, "plan");
    trace = appendToolStart(trace, "ReadPresentationSnapshot", "read");
    trace = finishTool(trace, "ReadPresentationSnapshot", "read done");
    trace = appendReasoningChunk(trace, "submit");
    trace = appendToolStart(trace, "SubmitCommands", "submit tool");

    expect(trace).toHaveLength(4);
    expect(trace[0].kind).toBe("reasoning");
    expect(trace[1]).toMatchObject({ kind: "tool", toolName: "ReadPresentationSnapshot", status: "done" });
    expect(trace[2].kind).toBe("reasoning");
    expect(trace[3]).toMatchObject({ kind: "tool", toolName: "SubmitCommands", status: "running" });

    trace = finishTool(trace, "SubmitCommands", "submit done");
    trace = markTraceComplete(trace);

    expect(trace[3]).toMatchObject({ kind: "tool", toolName: "SubmitCommands", status: "done" });
  });
});
