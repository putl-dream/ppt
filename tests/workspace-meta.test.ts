import { describe, expect, it } from "vitest";
import {
  getSessionSandboxPath,
  getWorkspaceMetaDir,
  getWorkspaceProjectPath,
  getWorkspaceSessionSnapshotPath,
  getWorkspaceSessionsIndexPath,
  isFlatWorkspaceSandboxPath,
  isLegacyProjectSandboxPath,
  isSessionSandboxPath,
  resolveWorkspaceRootFromProjectPath,
} from "../src/shared/workspace-meta";

describe("workspace-meta", () => {
  const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();

  it("builds stable workspace metadata paths", () => {
    expect(normalize(getWorkspaceMetaDir("D:/Projects/Q3"))).toBe("d:/projects/q3/.agent-ppt");
    expect(normalize(getWorkspaceProjectPath("D:/Projects/Q3"))).toBe(
      "d:/projects/q3/.agent-ppt/project.json",
    );
    expect(normalize(getWorkspaceSessionsIndexPath("D:/Projects/Q3"))).toBe(
      "d:/projects/q3/.agent-ppt/sessions.index.json",
    );
    expect(normalize(getWorkspaceSessionSnapshotPath("D:/Projects/Q3", "session-1"))).toBe(
      "d:/projects/q3/.agent-ppt/sessions/session-1.json",
    );
  });

  it("detects legacy projects/session-{id} sandboxes", () => {
    const projectsRoot = "C:/AppData/projects";
    expect(isLegacyProjectSandboxPath(`${projectsRoot}/session-abc`, projectsRoot)).toBe(true);
    expect(isLegacyProjectSandboxPath("D:/MyWorkspace", projectsRoot)).toBe(false);
  });

  it("builds per-session sandbox paths under a workspace", () => {
    expect(normalize(getSessionSandboxPath("D:/Projects/Q3", "abc-123"))).toBe(
      "d:/projects/q3/sandboxes/abc-123",
    );
    expect(isSessionSandboxPath("D:/Projects/Q3/sandboxes/abc-123", "D:/Projects/Q3")).toBe(true);
    expect(isSessionSandboxPath("D:/Projects/Q3/brief.md", "D:/Projects/Q3")).toBe(false);
    expect(normalize(resolveWorkspaceRootFromProjectPath("D:/Projects/Q3/sandboxes/abc-123"))).toBe(
      "d:/projects/q3",
    );
    expect(isFlatWorkspaceSandboxPath("D:/Projects/Q3")).toBe(true);
    expect(isFlatWorkspaceSandboxPath("D:/Projects/Q3/sandboxes/abc-123")).toBe(false);
  });
});
