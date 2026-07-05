import { describe, expect, it } from "vitest";
import {
  appendReasoningChunk,
  appendToolStart,
  appendToolValidationFailed,
  finishTool,
  isProcessTraceActive,
  markTraceComplete,
  mergeActivityTraces,
  splitTraceItems,
  summarizeProcessTrace,
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

  it("records failed tool attempts with streamed summary", () => {
    const trace: AgentActivityItem[] = [
      {
        id: "preview",
        kind: "tool-summary",
        toolName: "SubmitCommands",
        content: "准备提交方案",
        streaming: true,
      },
    ];

    const failed = appendToolValidationFailed(
      trace,
      "SubmitCommands",
      "assumptions must be array",
    );

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      kind: "tool",
      toolName: "SubmitCommands",
      summary: "准备提交方案",
      status: "done",
    });
    expect(failed[0].kind === "tool" && failed[0].finishedLabel).toContain("参数校验失败");
  });

  it("absorbs tool-summary into tool block on start", () => {
    let trace: AgentActivityItem[] = [
      {
        id: "preview",
        kind: "tool-summary",
        toolName: "SubmitCommands",
        content: "方案说明",
        streaming: true,
      },
    ];
    trace = appendToolStart(trace, "SubmitCommands", "run");
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({
      kind: "tool",
      toolName: "SubmitCommands",
      summary: "方案说明",
      status: "running",
    });
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

  it("splits process trace items from standalone task graph cards", () => {
    const trace: AgentActivityItem[] = [
      { id: "1", kind: "reasoning", content: "plan", streaming: false },
      {
        id: "2",
        kind: "tool",
        toolName: "ReadPresentationSnapshot",
        label: "read",
        status: "done",
      },
      {
        id: "graph",
        kind: "taskgraph",
        tasks: [{
          id: "t1",
          subject: "task",
          description: "do work",
          status: "pending",
          owner: null,
          blockedBy: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }],
        goal: "goal",
      },
    ];

    const { processItems, standaloneItems } = splitTraceItems(trace);
    expect(processItems).toHaveLength(2);
    expect(standaloneItems).toHaveLength(1);
    expect(standaloneItems[0]?.kind).toBe("taskgraph");
  });

  it("summarizes completed process trace for collapsed header", () => {
    const trace: AgentActivityItem[] = [
      { id: "1", kind: "reasoning", content: "a", streaming: false, modelStep: 0 },
      { id: "2", kind: "reasoning", content: "b", streaming: false, modelStep: 1 },
      {
        id: "3",
        kind: "tool",
        toolName: "ReadPresentationSnapshot",
        label: "read",
        status: "done",
      },
      { id: "4", kind: "step", text: "启动阶段", status: "done" },
    ];

    expect(summarizeProcessTrace(trace)).toBe("2 轮思考 · 1 次工具调用 · 1 个步骤");
    expect(isProcessTraceActive(trace)).toBe(false);
  });

  it("detects active process trace while streaming or running", () => {
    const trace: AgentActivityItem[] = [
      { id: "1", kind: "reasoning", content: "thinking", streaming: true },
      {
        id: "2",
        kind: "tool",
        toolName: "SubmitCommands",
        label: "run",
        status: "running",
      },
    ];

    expect(isProcessTraceActive(trace)).toBe(true);
    expect(isProcessTraceActive(markTraceComplete(trace))).toBe(false);
  });
});

describe("process trace rows", () => {
  it("builds flat titled rows for mixed process items", async () => {
    const { buildProcessTraceRows } = await import("../src/renderer/src/components/process-trace-rows");
    const rows = buildProcessTraceRows([
      { id: "1", kind: "reasoning", content: "plan", streaming: false, modelStep: 0 },
      {
        id: "2",
        kind: "tool",
        toolName: "ReadPresentationSnapshot",
        label: "read deck",
        status: "done",
        finishedLabel: "done",
      },
    ], false);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.title).toBe("模型思考");
    expect(rows[1]?.title).toBe("工具调用 · ReadPresentationSnapshot");
    expect(rows[1]?.lines).toEqual(["read deck", "done"]);
  });
});
