import { describe, expect, it } from "vitest";
import { type AgentActivityItem, summarizeProcessTrace } from "../src/shared/agent-activity";

function tool(
  toolName: string,
  status: Extract<AgentActivityItem, { kind: "tool" }>["status"],
  id = crypto.randomUUID(),
): Extract<AgentActivityItem, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    toolCallId: id,
    toolName,
    status,
  };
}

describe("summarizeProcessTrace", () => {
  it("aggregates mixed tools by display category", () => {
    const summary = summarizeProcessTrace([
      tool("ReadFile", "completed"),
      tool("Glob", "completed"),
      tool("WriteFile", "completed"),
      tool("ReadFile", "completed"),
    ]);
    expect(summary).toBe("已查看 2 项 · 搜索 1 次 · 更新 1 项");
  });

  it("prefers the latest running tool while live", () => {
    const summary = summarizeProcessTrace(
      [tool("ReadFile", "completed"), tool("WriteFile", "running")],
      { live: true },
    );
    expect(summary).toBe("正在保存工作文件…");
  });

  it("appends incomplete count for failed tools", () => {
    const summary = summarizeProcessTrace([
      tool("ReadFile", "completed"),
      tool("WriteFile", "failed"),
      tool("Glob", "denied"),
    ]);
    expect(summary).toBe("已查看 1 项 · 搜索 1 次 · 更新 1 项 · 2 项未完成");
  });

  it("falls back for reasoning-only and empty traces", () => {
    expect(summarizeProcessTrace([])).toBe("执行过程");
    expect(
      summarizeProcessTrace([
        {
          id: "r1",
          kind: "reasoning",
          content: "thinking",
        },
      ]),
    ).toBe("思考片刻");
  });

  it("counts teammate task tool steps", () => {
    const summary = summarizeProcessTrace([
      {
        id: "task-1",
        kind: "task",
        taskId: "t1",
        description: "write page",
        status: "completed",
        steps: [
          {
            id: "s1",
            type: "tool",
            text: "read",
            toolName: "ReadFile",
            status: "completed",
          },
          {
            id: "s2",
            type: "tool",
            text: "write",
            toolName: "WriteFile",
            status: "completed",
          },
          {
            id: "s3",
            type: "reasoning",
            text: "done",
            status: "completed",
          },
        ],
      },
    ]);
    expect(summary).toBe("已查看 1 项 · 更新 1 项");
  });
});
