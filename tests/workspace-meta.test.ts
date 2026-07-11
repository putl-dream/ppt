import { describe, expect, it } from "vitest";
import {
  getSessionSandboxPath,
  getWorkspaceProjectPath,
  isSessionSandboxPath,
  resolveWorkspaceRootFromProjectPath,
} from "../src/shared/workspace-meta";

const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();

describe("workspace-meta", () => {
  it("keeps only a stable project identity file at workspace root", () => {
    expect(normalize(getWorkspaceProjectPath("D:/Projects/Q3"))).toBe(
      "d:/projects/q3/.agent-ppt-project.json",
    );
  });

  it("maps each central session to an independent stable artifact sandbox", () => {
    const sandbox = getSessionSandboxPath("D:/Projects/Q3", "session-1");
    expect(normalize(sandbox)).toBe("d:/projects/q3/sandboxes/session-1");
    expect(isSessionSandboxPath(sandbox, "D:/Projects/Q3")).toBe(true);
    expect(normalize(resolveWorkspaceRootFromProjectPath(sandbox))).toBe("d:/projects/q3");
  });
});
