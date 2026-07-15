import { describe, expect, it } from "vitest";
import {
  applyTeammateProgressEvent,
  markTraceComplete,
  type AgentActivityItem,
} from "../src/shared/agent-activity";
import type { TeammateProgressEvent } from "../src/shared/teammate-progress";

describe("teammate progress activity", () => {
  it("projects assignment reasoning and tool calls into one task trace", () => {
    const events: TeammateProgressEvent[] = [
      {
        type: "teammate-assignment-started",
        teammateName: "task_worker",
        activityId: "task-outline",
        taskId: "task-outline",
        description: "Create outline",
      },
      {
        type: "teammate-thinking-chunk",
        teammateName: "task_worker",
        activityId: "task-outline",
        taskId: "task-outline",
        chunk: "Inspecting source material.",
      },
      {
        type: "teammate-tool-started",
        teammateName: "task_worker",
        activityId: "task-outline",
        taskId: "task-outline",
        toolName: "write_file",
        message: "正在调用 write_file",
      },
      {
        type: "teammate-tool-finished",
        teammateName: "task_worker",
        activityId: "task-outline",
        taskId: "task-outline",
        toolName: "write_file",
        message: "write_file 已完成",
        status: "completed",
      },
      {
        type: "teammate-assignment-finished",
        teammateName: "task_worker",
        activityId: "task-outline",
        taskId: "task-outline",
        status: "completed",
      },
    ];

    const trace = events.reduce<AgentActivityItem[]>(applyTeammateProgressEvent, []);
    expect(trace).toEqual([
      expect.objectContaining({
        kind: "task",
        taskId: "task-outline",
        description: "Create outline · task_worker",
        status: "done",
        steps: [
          expect.objectContaining({
            type: "reasoning",
            text: "Inspecting source material.",
            status: "done",
          }),
          expect.objectContaining({
            type: "tool",
            toolName: "write_file",
            text: "write_file 已完成",
            status: "done",
          }),
        ],
      }),
    ]);
  });

  it("keeps a teammate task running when only the lead run completes", () => {
    const running = applyTeammateProgressEvent([], {
      type: "teammate-assignment-started",
      teammateName: "task_worker",
      activityId: "task-layout",
      taskId: "task-layout",
      description: "Build layout plan",
    });

    expect(markTraceComplete(running)[0]).toMatchObject({
      kind: "task",
      taskId: "task-layout",
      status: "running",
    });
  });
});
