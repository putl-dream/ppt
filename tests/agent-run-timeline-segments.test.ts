import {
  buildAgentRunTimelineSegments,
  isToolBatchActive,
  shouldAutoCollapseToolBatch,
} from "@shared/agent-run-timeline-segments";
import { describe, expect, it } from "vitest";
import type { AgentActivityItem } from "../src/shared/agent-activity";

describe("buildAgentRunTimelineSegments", () => {
  it("groups thought with following tools until a response boundary", () => {
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
      "tool_batch",
      "response",
      "tool_batch",
    ]);

    const firstBatch = segments[0];
    expect(firstBatch?.kind).toBe("tool_batch");
    if (firstBatch?.kind === "tool_batch") {
      expect(firstBatch.items.map((item) => item.id)).toEqual(["r1", "t1", "t2"]);
    }

    const secondBatch = segments[2];
    expect(secondBatch?.kind).toBe("tool_batch");
    if (secondBatch?.kind === "tool_batch") {
      expect(secondBatch.items.map((item) => item.id)).toEqual(["r2", "t3"]);
    }
  });

  it("keeps orphan reasoning as thought when no tools follow before response", () => {
    const segments = buildAgentRunTimelineSegments([
      {
        id: "r1",
        kind: "reasoning",
        content: "plan",
      },
      {
        id: "resp1",
        kind: "response",
        start: 0,
        end: 4,
      },
      {
        id: "t1",
        kind: "tool",
        toolCallId: "c1",
        toolName: "ReadFile",
        status: "completed",
      },
    ]);

    expect(segments.map((segment) => segment.kind)).toEqual(["thought", "response", "tool_batch"]);
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
      expect(segments[0].items.map((item) => item.kind)).toEqual(["tool", "tool-approval", "step"]);
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
    expect(
      shouldAutoCollapseToolBatch({
        items: completedTools,
        runLive: true,
        hasLaterResponse: true,
      }),
    ).toBe(true);
    expect(
      isToolBatchActive({
        items: completedTools,
        runLive: true,
        hasLaterResponse: true,
      }),
    ).toBe(false);
  });

  it("run end without trailing response still collapses (!live)", () => {
    expect(
      shouldAutoCollapseToolBatch({
        items: completedTools,
        runLive: false,
        hasLaterResponse: false,
      }),
    ).toBe(true);
    expect(
      isToolBatchActive({
        items: completedTools,
        runLive: false,
        hasLaterResponse: false,
      }),
    ).toBe(false);
  });

  it("stays active while live with no later response", () => {
    expect(
      isToolBatchActive({
        items: completedTools,
        runLive: true,
        hasLaterResponse: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoCollapseToolBatch({
        items: completedTools,
        runLive: true,
        hasLaterResponse: false,
      }),
    ).toBe(false);
  });
});
