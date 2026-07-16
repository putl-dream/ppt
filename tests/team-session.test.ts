import { describe, expect, it } from "vitest";
import type { AgentActivityItem } from "../src/shared/agent-activity";
import {
  collectTeamSessions,
  projectTeamSession,
  teamSessionFingerprint,
} from "../src/shared/team-session";

describe("team session projection", () => {
  it("projects protocol fields and user-facing tool activity", () => {
    const activity: Extract<AgentActivityItem, { kind: "task" }> = {
      id: "trace-1",
      kind: "task",
      taskId: "task-1",
      taskGraphId: "task-1",
      agentName: "outline_writer",
      description: "起草大纲",
      status: "running",
      steps: [{
        id: "step-1",
        type: "tool",
        toolName: "write_file",
        text: "正在调用 write_file",
        status: "running",
      }],
    };

    const session = projectTeamSession(activity, [{
      id: "task-1",
      subject: "编写演示大纲",
      description: "",
      status: "in_progress",
      executionTarget: "teammate",
      owner: "outline_writer",
      blockedBy: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }]);

    expect(session).toMatchObject({
      id: "task-1",
      agentName: "outline_writer",
      title: "编写演示大纲",
      currentActivity: "正在保存工作文件…",
      status: "running",
      toolCount: 1,
    });
  });

  it("keeps legacy persisted tasks compatible and separates cancelled from errors", () => {
    const legacy: Extract<AgentActivityItem, { kind: "task" }> = {
      id: "trace-legacy",
      kind: "task",
      taskId: "legacy-task",
      description: "调研竞品 · researcher_1",
      status: "interrupted",
      steps: [],
    };

    expect(projectTeamSession(legacy)).toMatchObject({
      agentName: "researcher_1",
      title: "调研竞品",
      status: "cancelled",
      currentActivity: "任务已取消",
    });
  });

  it("deduplicates live snapshots and changes fingerprints on meaningful progress", () => {
    const early: AgentActivityItem = {
      id: "trace",
      kind: "task",
      taskId: "task-1",
      description: "执行任务",
      status: "running",
      steps: [],
    };
    const later: AgentActivityItem = {
      ...early,
      steps: [{
        id: "step-1",
        type: "reasoning",
        text: "分析中",
        status: "running",
        streaming: true,
      }],
    };

    const [earlySession] = collectTeamSessions([[early]]);
    const sessions = collectTeamSessions([[early], [later]]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.stepCount).toBe(1);
    expect(teamSessionFingerprint(sessions[0]!)).not.toBe(
      teamSessionFingerprint(earlySession!),
    );
  });
});
