import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach } from "vitest";
import {
  clearHooks,
  registerHook,
  triggerHooks,
} from "../src/main/agent/runtime/hooks/hook-registry";
import {
  evaluatePermission,
  createPermissionPreToolUseHook,
  type PreToolUseBlock,
} from "../src/main/agent/runtime/tools/permission-check";

function createBlock(overrides: Partial<PreToolUseBlock> = {}): PreToolUseBlock {
  return {
    event: "PreToolUse",
    toolName: "bash",
    args: { command: "ls" },
    scope: "subagent",
    workspaceRoot: "/workspace",
    ...overrides,
  };
}

describe("Hook registry", () => {
  beforeEach(() => {
    clearHooks();
  });

  it("runs callbacks in registration order until one returns stop", async () => {
    const trace: string[] = [];
    registerHook("PreToolUse", () => {
      trace.push("first");
      return null;
    });
    registerHook("PreToolUse", () => {
      trace.push("second");
      return { type: "stop", reason: "halt" };
    });
    registerHook("PreToolUse", () => {
      trace.push("third");
      return null;
    });

    const result = await triggerHooks("PreToolUse", { event: "PreToolUse" });
    expect(result).toEqual({ type: "stop", reason: "halt" });
    expect(trace).toEqual(["first", "second"]);
  });

  it("returns null when no hook stops the chain", async () => {
    registerHook("UserPromptSubmit", () => null);
    const result = await triggerHooks("UserPromptSubmit", { event: "UserPromptSubmit" });
    expect(result).toBeNull();
  });
});

describe("Permission gates", () => {
  it("gate 1 hard-denies destructive commands", () => {
    expect(evaluatePermission(createBlock({
      args: { command: "sudo rm -rf /" },
    }))).toEqual({ type: "deny", reason: "禁止使用 sudo" });

    expect(evaluatePermission(createBlock({
      args: { command: "rm -rf /" },
    }))).toEqual({ type: "deny", reason: "禁止删除根目录" });
  });

  it("allows in-workspace writes and shell without approval", () => {
    expect(evaluatePermission(createBlock({
      toolName: "write_file",
      args: { path: "notes.md", content: "hello" },
    }))).toEqual({ type: "allow" });

    expect(evaluatePermission(createBlock({
      toolName: "edit_file",
      args: { path: "notes.md", old_string: "a", new_string: "b" },
    }))).toEqual({ type: "allow" });

    expect(evaluatePermission(createBlock({
      toolName: "ensure_dir",
      args: { path: "slides" },
    }))).toEqual({ type: "allow" });

    expect(evaluatePermission(createBlock({
      args: { command: "echo hi" },
    }))).toEqual({ type: "allow" });
  });

  it("requires approval for delete commands", () => {
    expect(evaluatePermission(createBlock({
      args: { command: "rm notes.md" },
    }))).toEqual({
      type: "require_approval",
      reason: "删除命令：rm notes.md",
    });
  });

  it("requires approval for outside-workspace file access", () => {
    expect(evaluatePermission(createBlock({
      toolName: "write_file",
      args: { path: "../outside.txt", content: "x" },
      workspaceRoot: awaitableWorkspace(),
    }))).toEqual({
      type: "require_approval",
      reason: "尝试写入工作区外路径：../outside.txt",
    });

    expect(evaluatePermission(createBlock({
      toolName: "read_file",
      args: { path: "../outside.txt" },
      workspaceRoot: awaitableWorkspace(),
    }))).toEqual({
      type: "require_approval",
      reason: "访问工作区外的文件：../outside.txt",
    });

    expect(evaluatePermission(createBlock({
      toolName: "ensure_dir",
      args: { path: "../outside" },
      workspaceRoot: awaitableWorkspace(),
    }))).toEqual({
      type: "require_approval",
      reason: "尝试写入工作区外路径：../outside",
    });

    expect(evaluatePermission(createBlock({
      toolName: "glob",
      args: { pattern: "../**/*.pptx" },
      workspaceRoot: awaitableWorkspace(),
    }))).toEqual({
      type: "require_approval",
      reason: "访问工作区外的目录：../**/*.pptx",
    });
  });

  it("allows read-only operations inside workspace without approval", () => {
    expect(evaluatePermission(createBlock({
      toolName: "read_file",
      args: { path: "notes.md" },
    }))).toEqual({ type: "allow" });

    expect(evaluatePermission(createBlock({
      toolName: "glob",
      args: { pattern: "**/*.md" },
    }))).toEqual({ type: "allow" });
  });

  it("gate 3 denies when approval handler is missing for protected ops", async () => {
    const hook = createPermissionPreToolUseHook();
    const result = await hook(createBlock({
      args: { command: "rm notes.md" },
    }));
    expect(result).toEqual({
      type: "stop",
      reason: "操作需要用户确认：删除命令：rm notes.md",
      toolDenied: true,
    });
  });

  it("gate 3 respects user approval decision", async () => {
    const hook = createPermissionPreToolUseHook();
    const denied = await hook(createBlock({
      args: { command: "rm notes.md" },
      requestToolApproval: async () => false,
    }));
    expect(denied).toEqual({
      type: "stop",
      reason: "用户拒绝了该工具操作。",
      toolDenied: true,
    });

    const approved = await hook(createBlock({
      args: { command: "rm notes.md" },
      requestToolApproval: async () => true,
    }));
    expect(approved).toBeNull();
  });
});

function awaitableWorkspace(): string {
  return join(tmpdir(), "ppt-perm-test");
}
