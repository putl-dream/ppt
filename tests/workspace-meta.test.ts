import { describe, expect, it } from "vitest";
import {
  getWorkspaceMetaDir,
  getWorkspaceProjectPath,
  getWorkspaceSessionSnapshotPath,
  getWorkspaceSessionsIndexPath,
  isLegacyProjectSandboxPath,
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
});
