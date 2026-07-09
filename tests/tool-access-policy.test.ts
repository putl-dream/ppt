import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateToolPermission,
  getToolPermissionProfile,
  isRiskApprovalHintRequired,
} from "../src/main/agent/runtime/tool-access-policy";
import { SUB_AGENT_TOOLS } from "../src/main/agent/subagent/workspace-tools";

const workspaceRoot = join(tmpdir(), "ppt-tool-policy");

describe("tool access policy", () => {
  it("keeps sub-agent tool permission metadata in one policy registry", () => {
    for (const tool of SUB_AGENT_TOOLS) {
      expect(tool.permission).toBe(getToolPermissionProfile(tool.name));
      expect(tool.permission.scopes).toContain("subagent");
    }
  });

  it("preserves hard-deny and contextual approval behavior", () => {
    expect(evaluateToolPermission({
      toolName: "bash",
      args: { command: "sudo rm -rf /" },
      workspaceRoot,
    })).toEqual({ type: "deny", reason: "禁止使用 sudo" });

    expect(evaluateToolPermission({
      toolName: "bash",
      args: { command: "rm notes.md" },
      workspaceRoot,
    })).toEqual({ type: "require_approval", reason: "删除命令：rm notes.md" });

    expect(evaluateToolPermission({
      toolName: "read_file",
      args: { path: "../outside.txt" },
      workspaceRoot,
    })).toEqual({
      type: "require_approval",
      reason: "访问工作区外的文件：../outside.txt",
    });

    expect(evaluateToolPermission({
      toolName: "write_file",
      args: { path: "notes.md", content: "hello" },
      workspaceRoot,
    })).toEqual({ type: "allow" });
  });

  it("keeps risk-based approval as a central model-visible hint", () => {
    expect(isRiskApprovalHintRequired("low")).toBe(false);
    expect(isRiskApprovalHintRequired("medium")).toBe(true);
    expect(isRiskApprovalHintRequired("high")).toBe(true);
  });
});
