import { describe, expect, it } from "vitest";
import {
  appendReasoningChunk,
  appendToolStart,
  appendToolValidationFailed,
  compactActivityTraceForPersistence,
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

  it("keeps the newest task graph snapshot even when an older trace is longer", () => {
    const oldGraph: AgentActivityItem = {
      id: "agent-task-graph",
      kind: "taskgraph",
      goal: "goal",
      tasks: [
        {
          id: "task-1",
          subject: "起草 Brief",
          description: "",
          status: "in_progress",
          owner: "agent",
          blockedBy: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const newerGraph: AgentActivityItem = {
      ...oldGraph,
      tasks: [
        {
          ...oldGraph.tasks[0],
          status: "completed",
          owner: null,
          updatedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
    };
    const longerExisting: AgentActivityItem[] = [
      oldGraph,
      { id: "step-1", kind: "step", text: "继续处理", status: "done" },
    ];

    const merged = mergeActivityTraces(longerExisting, [newerGraph]);
    const graph = merged?.find((item) => item.kind === "taskgraph");

    expect(merged).toHaveLength(2);
    expect(graph).toMatchObject({
      kind: "taskgraph",
      tasks: [{ id: "task-1", status: "completed", owner: null }],
    });
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
    expect(failed[0].kind === "tool" && failed[0].finishedLabel).toContain("输入信息有误");
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

    expect(summarizeProcessTrace(trace)).toBe("2 轮思考 · 1 项操作 · 1 个步骤");
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
    const failed = markTraceComplete(trace, "failed");
    expect(failed[1]).toMatchObject({
      kind: "tool",
      status: "done",
      finishedLabel: "提交修改方案未完成",
    });
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
    expect(rows[0]).toMatchObject({ kind: "thought", title: "思考片刻" });
    expect(rows[1]).toMatchObject({ kind: "tools", title: "读取 1 项" });
    expect(rows[1]?.lines).toEqual(["已读取演示文稿"]);
  });

  it("groups consecutive tools and keeps progress as a direct work row", async () => {
    const { buildProcessTraceRows } = await import("../src/renderer/src/components/process-trace-rows");
    const rows = buildProcessTraceRows([
      { id: "progress", kind: "step", text: "正在梳理相关组件", status: "done" },
      {
        id: "read",
        kind: "tool",
        toolName: "ReadPresentationSnapshot",
        label: "运行读取工具",
        status: "done",
        finishedLabel: "读取完成",
      },
      {
        id: "search",
        kind: "tool",
        toolName: "WebSearch",
        label: "正在搜索",
        status: "running",
      },
    ], true);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "progress",
      title: "正在梳理相关组件",
      active: false,
    });
    expect(rows[1]).toMatchObject({
      kind: "tools",
      title: "正在读取 1 项 · 搜索 1 次",
      active: true,
    });
    expect(rows[1]?.lines).toEqual([
      "已读取演示文稿",
      "正在查找在线资料…",
    ]);
  });

  it("normalizes legacy and failed tool labels without exposing protocol names", async () => {
    const { buildProcessTraceRows } = await import("../src/renderer/src/components/process-trace-rows");
    const rows = buildProcessTraceRows([
      {
        id: "preview",
        kind: "tool",
        toolName: "PreviewCommands",
        label: "🛠️ 运行工具: PreviewCommands",
        status: "done",
        finishedLabel: "✅ 工具 PreviewCommands 运行完毕",
      },
      {
        id: "failed",
        kind: "tool",
        toolName: "ExportPptx",
        label: "正在调用工具 ExportPptx...",
        status: "done",
        finishedLabel: "工具 ExportPptx 执行失败: EACCES",
      },
      {
        id: "unknown",
        kind: "tool",
        toolName: "InternalFoo_v2",
        label: "run",
        status: "done",
        finishedLabel: "done",
      },
      {
        id: "interrupted",
        kind: "tool",
        toolName: "ReadPresentationSnapshot",
        label: "正在读取演示文稿…",
        status: "done",
      },
    ], false);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.lines).toEqual([
      "已检查修改方案",
      "导出演示文稿未完成",
      "已处理当前任务",
      "读取演示文稿未完成",
    ]);
    expect(rows[0]?.lines?.join(" ")).not.toMatch(
      /PreviewCommands|ExportPptx|InternalFoo_v2|ReadPresentationSnapshot/,
    );
  });

  it("compacts oversized traces while preserving task graphs and approvals", () => {
    const taskgraph: AgentActivityItem = {
      id: "graph",
      kind: "taskgraph",
      tasks: [],
      goal: "layout",
    };
    const approval: AgentActivityItem = {
      id: "approval",
      kind: "tool-approval",
      approvalId: "a1",
      toolName: "SubmitCommands",
      reason: "risky",
      detail: "detail",
      status: "approved",
    };
    const steps: AgentActivityItem[] = Array.from({ length: 100 }, (_, index) => ({
      id: `step-${index}`,
      kind: "step" as const,
      text: `step ${index}`,
      status: "done" as const,
    }));

    const compacted = compactActivityTraceForPersistence([taskgraph, approval, ...steps]);
    expect(compacted).toBeDefined();
    expect(compacted!.length).toBeLessThanOrEqual(80);
    expect(compacted!.some((item) => item.id === "graph")).toBe(true);
    expect(compacted!.some((item) => item.id === "approval")).toBe(true);
    expect(compacted!.some((item) => item.id === "step-99")).toBe(true);
    expect(compacted!.some((item) => item.id === "step-0")).toBe(false);
  });

  it("keeps the persisted trace within hard item and byte limits", () => {
    const approvals: AgentActivityItem[] = Array.from({ length: 90 }, (_, index) => ({
      id: `approval-${index}`,
      kind: "tool-approval" as const,
      approvalId: `a-${index}`,
      toolName: "SubmitCommands",
      reason: "r".repeat(10_000),
      detail: "d".repeat(10_000),
      status: index === 89 ? "pending" as const : "approved" as const,
    }));
    const steps: AgentActivityItem[] = Array.from({ length: 100 }, (_, index) => ({
      id: `step-${index}`,
      kind: "step" as const,
      text: "x".repeat(10_000),
      status: "done" as const,
    }));

    const compacted = compactActivityTraceForPersistence([...approvals, ...steps])!;

    expect(compacted.length).toBeLessThanOrEqual(80);
    expect(new TextEncoder().encode(JSON.stringify(compacted)).byteLength).toBeLessThanOrEqual(
      96 * 1_024,
    );
    expect(compacted.some((item) => item.id === "approval-89")).toBe(true);
    expect(compacted.some((item) => item.id === "step-99")).toBe(true);
  });

  it("bounds nested task steps and long streamed text", () => {
    const task: AgentActivityItem = {
      id: "task",
      kind: "task",
      taskId: "task-1",
      description: "d".repeat(10_000),
      status: "done",
      steps: Array.from({ length: 100 }, (_, index) => ({
        id: `nested-${index}`,
        type: "reasoning" as const,
        text: "t".repeat(10_000),
        status: "done" as const,
      })),
    };
    const reasoning: AgentActivityItem = {
      id: "reasoning",
      kind: "reasoning",
      content: "r".repeat(20_000),
      streaming: false,
    };

    const compacted = compactActivityTraceForPersistence([task, reasoning])!;
    const compactedTask = compacted.find((item) => item.kind === "task");
    const compactedReasoning = compacted.find((item) => item.kind === "reasoning");

    expect(compactedTask?.kind === "task" ? compactedTask.steps.length : 0).toBeLessThanOrEqual(24);
    expect(compactedReasoning?.kind === "reasoning" ? compactedReasoning.content.length : 0)
      .toBeLessThanOrEqual(4_000);
  });
});
