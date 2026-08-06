import { describe, expect, it } from "vitest";
import type { AgentActivityItem } from "../src/shared/agent-activity";
import {
  buildAgentRunTimelineSegments,
  isToolBatchActive,
  shouldAutoCollapseToolBatch,
} from "../src/renderer/src/components/agent-run-timeline-segments";

describe("buildAgentRunTimelineSegments", () => {
  it("keeps thought and tool batches separate in order", () => {
    const items: AgentActivityItem[] = [
      {
        id: "r1",
        kind: "reasoning",
        content: "plan",
      },
      {
        id: "t1",
        kind: "tool",
        toolCallId: "c1",
        toolName: "ReadFile",
        status: "completed",
      },
      {
        id: "t2",
        kind: "tool",
        toolCallId: "c2",
        toolName: "Glob",
        status: "completed",
      },
      {
        id: "resp1",
        kind: "response",
        start: 0,
        end: 4,
      },
      {
        id: "r2",
        kind: "reasoning",
        content: "next",
      },
      {
        id: "t3",
        kind: "tool",
        toolCallId: "c3",
        toolName: "WriteFile",
        status: "running",
      },
    ];

    const segments = buildAgentRunTimelineSegments(items);
    expect(segments.map((segment) => segment.kind)).toEqual([
      "thought",
      "tool_batch",
      "response",
      "thought",
      "tool_batch",
    ]);

    const firstBatch = segments[1];
    expect(firstBatch?.kind).toBe("tool_batch");
    if (firstBatch?.kind === "tool_batch") {
      expect(firstBatch.items.map((item) => item.id)).toEqual(["t1", "t2"]);
      expect(firstBatch.items.every((item) => item.kind !== "reasoning")).toBe(true);
    }
  });

  it("groups approvals and steps into the tool batch", () => {
    const segments = buildAgentRunTimelineSegments([
      {
        id: "tool-1",
        kind: "tool",
        toolCallId: "c1",
        toolName: "WriteFile",
        status: "running",
      },
      {
        id: "approval-1",
        kind: "tool-approval",
        approvalId: "a1",
        toolName: "WriteFile",
        reason: "needs approval",
        detail: "path",
        status: "pending",
      },
      {
        id: "step-1",
        kind: "step",
        text: "L2 micro_compact: done",
        status: "done",
      },
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe("tool_batch");
    if (segments[0]?.kind === "tool_batch") {
      expect(segments[0].items.map((item) => item.kind)).toEqual([
        "tool",
        "tool-approval",
        "step",
      ]);
    }
  });
});

describe("tool batch open helpers", () => {
  const completedTools: AgentActivityItem[] = [
    {
      id: "t1",
      kind: "tool",
      toolCallId: "c1",
      toolName: "ReadFile",
      status: "completed",
    },
  ];

  it("final text round collapses when later response exists", () => {
    expect(shouldAutoCollapseToolBatch({
      items: completedTools,
      runLive: true,
      hasLaterResponse: true,
    })).toBe(true);
    expect(isToolBatchActive({
      items: completedTools,
      runLive: true,
      hasLaterResponse: true,
    })).toBe(false);
  });

  it("run end without trailing response still collapses (!live)", () => {
    expect(shouldAutoCollapseToolBatch({
      items: completedTools,
      runLive: false,
      hasLaterResponse: false,
    })).toBe(true);
    expect(isToolBatchActive({
      items: completedTools,
      runLive: false,
      hasLaterResponse: false,
    })).toBe(false);
  });

  it("stays active while live with no later response", () => {
    expect(isToolBatchActive({
      items: completedTools,
      runLive: true,
      hasLaterResponse: false,
    })).toBe(true);
    expect(shouldAutoCollapseToolBatch({
      items: completedTools,
      runLive: true,
      hasLaterResponse: false,
    })).toBe(false);
  });
});
