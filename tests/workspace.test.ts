import { describe, expect, it } from "vitest";
import {
  getWorkspaceLabel,
  groupSessionsByWorkspace,
  normalizeWorkspacePath,
  sessionsForWorkspace,
} from "@shared/workspace";

describe("workspace helpers", () => {
  it("normalizes windows paths for comparison", () => {
    expect(normalizeWorkspacePath("D:\\Projects\\Q3")).toBe("d:/Projects/Q3");
    expect(normalizeWorkspacePath("d:/Projects/Q3/")).toBe("d:/Projects/Q3");
  });

  it("derives workspace labels", () => {
    expect(getWorkspaceLabel()).toBe("未打开项目目录");
    expect(getWorkspaceLabel("D:/Projects/Q3汇报")).toBe("Q3汇报");
  });

  it("filters sessions by workspace path", () => {
    const sessions = [
      { id: "a", workspacePath: "d:/Projects/A" },
      { id: "b", workspacePath: "D:\\Projects\\A" },
      { id: "c", workspacePath: "d:/Projects/B" },
    ];

    expect(sessionsForWorkspace(sessions, "D:/Projects/A/")).toHaveLength(2);
    expect(sessionsForWorkspace(sessions, "d:/Projects/B")).toHaveLength(1);
  });

  it("groups sessions by workspace", () => {
    const groups = groupSessionsByWorkspace([
      { id: "a", workspacePath: "d:/Projects/A", updatedAt: "2026-01-02" },
      { id: "b", workspacePath: "d:/Projects/B", updatedAt: "2026-01-03" },
      { id: "c", updatedAt: "2026-01-01" },
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.workspacePath === "__unknown__")?.sessions).toHaveLength(1);
  });
});
