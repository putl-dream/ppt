import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach } from "vitest";
import {
  clearHooks,
  registerHook,
  triggerHooks,
} from "../src/main/agent/runtime/hook-registry";
import {
  evaluatePermission,
  createPermissionPreToolUseHook,
  type PreToolUseBlock,
} from "../src/main/agent/runtime/permission-check";
import {
  ensureDefaultHooks,
  resetDefaultHooksForTests,
} from "../src/main/agent/runtime/default-hooks";
import { spawnSubAgent } from "../src/main/agent/subagent/spawn-subagent";
import type { AgentModelGateway } from "../src/main/agent/gateway";

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

  it("gate 2 requires approval for file writes and rm", () => {
    expect(evaluatePermission(createBlock({
      toolName: "write_file",
      args: { path: "notes.md", content: "hello" },
    }))).toEqual({
      type: "require_approval",
      reason: "文件修改操作：notes.md",
    });

    expect(evaluatePermission(createBlock({
      args: { command: "rm notes.md" },
    }))).toEqual({
      type: "require_approval",
      reason: "删除命令：rm notes.md",
    });
  });

  it("gate 2 flags writes outside workspace", () => {
    expect(evaluatePermission(createBlock({
      toolName: "write_file",
      args: { path: "../outside.txt", content: "x" },
      workspaceRoot: awaitableWorkspace(),
    }))).toEqual({
      type: "require_approval",
      reason: "尝试写入工作区外路径：../outside.txt",
    });
  });

  it("allows read-only operations without approval", () => {
    expect(evaluatePermission(createBlock({
      toolName: "read_file",
      args: { path: "notes.md" },
    }))).toEqual({ type: "allow" });

    expect(evaluatePermission(createBlock({
      toolName: "glob",
      args: { pattern: "**/*.md" },
    }))).toEqual({ type: "allow" });
  });

  it("gate 3 denies when approval handler is missing", async () => {
    const hook = createPermissionPreToolUseHook();
    const result = await hook(createBlock({
      toolName: "write_file",
      args: { path: "a.md", content: "x" },
    }));
    expect(result).toEqual({
      type: "stop",
      reason: "操作需要用户确认：文件修改操作：a.md",
      toolDenied: true,
    });
  });

  it("gate 3 respects user approval decision", async () => {
    const hook = createPermissionPreToolUseHook();
    const denied = await hook(createBlock({
      toolName: "bash",
      args: { command: "echo hi" },
      requestToolApproval: async () => false,
    }));
    expect(denied).toEqual({
      type: "stop",
      reason: "用户拒绝了该工具操作。",
      toolDenied: true,
    });

    const approved = await hook(createBlock({
      toolName: "bash",
      args: { command: "echo hi" },
      requestToolApproval: async () => true,
    }));
    expect(approved).toBeNull();
  });
});

function awaitableWorkspace(): string {
  return join(tmpdir(), "ppt-perm-test");
}

describe("Sub-agent permission integration", () => {
  beforeEach(() => {
    clearHooks();
    resetDefaultHooksForTests();
    ensureDefaultHooks();
  });

  it("blocks hard-denied bash commands before execution", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-hook-deny-"));
    let gatewayCalls = 0;
    const gateway: AgentModelGateway = {
      async generateText() {
        gatewayCalls += 1;
        if (gatewayCalls === 1) {
          return {
            provider: "openai",
            model: "test",
            text: JSON.stringify({
              type: "tool_call",
              toolName: "bash",
              args: { command: "rm -rf /" },
            }),
          };
        }
        return {
          provider: "openai",
          model: "test",
          text: JSON.stringify({ type: "message", content: "Stopped after deny." }),
        };
      },
      async *generateTextStream() {
        yield { type: "complete" as const, text: "" };
      },
    };

    const conclusion = await spawnSubAgent({
      description: "dangerous",
      workspaceRoot,
      gateway,
      maxSteps: 3,
      requestToolApproval: async () => true,
    });

    expect(gatewayCalls).toBeGreaterThanOrEqual(1);
    expect(conclusion).toBe("Stopped after deny.");
  });

  it("executes write_file when user approves gate 2", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-hook-approve-"));
    let gatewayCalls = 0;
    const gateway: AgentModelGateway = {
      async generateText() {
        gatewayCalls += 1;
        if (gatewayCalls === 1) {
          return {
            provider: "openai",
            model: "test",
            text: JSON.stringify({
              type: "tool_call",
              toolName: "write_file",
              args: { path: "ok.md", content: "approved" },
            }),
          };
        }
        return {
          provider: "openai",
          model: "test",
          text: JSON.stringify({ type: "message", content: "Write complete." }),
        };
      },
      async *generateTextStream() {
        yield { type: "complete" as const, text: "" };
      },
    };

    let approvalAsked = false;
    const conclusion = await spawnSubAgent({
      description: "write",
      workspaceRoot,
      gateway,
      maxSteps: 3,
      requestToolApproval: async (req) => {
        approvalAsked = true;
        expect(req.toolName).toBe("write_file");
        return true;
      },
    });

    expect(approvalAsked).toBe(true);
    expect(conclusion).toBe("Write complete.");
  });
});
