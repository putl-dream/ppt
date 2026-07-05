import { isAbsolute, relative, resolve } from "node:path";
import type { HookCallback } from "./hook-registry";

export type ToolApprovalRequest = {
  toolName: string;
  args: unknown;
  reason: string;
};

export type ToolApprovalHandler = (request: ToolApprovalRequest) => Promise<boolean>;

export type PermissionDecision =
  | { type: "allow" }
  | { type: "deny"; reason: string }
  | { type: "require_approval"; reason: string };

export interface PreToolUseBlock {
  event: "PreToolUse";
  toolName: string;
  args: unknown;
  scope: "main" | "subagent";
  workspaceRoot?: string;
  threadId?: string;
  requestToolApproval?: ToolApprovalHandler;
}

/** 闸门 1：永远禁止的操作模式。 */
const HARD_DENY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/i, reason: "禁止使用 sudo" },
  { pattern: /\bsu\s+-/i, reason: "禁止使用 su" },
  { pattern: /rm\s+(-[^\s]*\s+)*\/(\s|$|\*)/i, reason: "禁止删除根目录" },
  { pattern: /rm\s+(-[^\s]*\s+)*\/\*/i, reason: "禁止递归删除根目录" },
  { pattern: /:\(\)\s*\{/, reason: "禁止 fork bomb" },
  { pattern: /\bdd\s+if=/i, reason: "禁止使用 dd 覆写磁盘" },
  { pattern: /\bmkfs\b/i, reason: "禁止格式化磁盘" },
  { pattern: /\bformat\s+[a-z]:/i, reason: "禁止格式化磁盘" },
  { pattern: /\bdel\s+\/s/i, reason: "禁止递归删除系统路径" },
  { pattern: /chmod\s+777\s+\//i, reason: "禁止修改根目录权限" },
  { pattern: /curl\s+[^\s|]+\s*\|\s*(ba)?sh/i, reason: "禁止管道执行远程脚本" },
  { pattern: /wget\s+[^\s|]+\s*\|\s*(ba)?sh/i, reason: "禁止管道执行远程脚本" },
];

function extractBashCommand(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" ? command : "";
}

function extractFilePath(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" ? path : "";
}

function extractGlobPattern(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const pattern = (args as { pattern?: unknown }).pattern;
  return typeof pattern === "string" ? pattern : "";
}

function isPathOutsideWorkspace(workspaceRoot: string | undefined, path: string): boolean {
  if (!workspaceRoot || !path.trim()) return false;
  if (isAbsolute(path)) {
    const root = resolve(workspaceRoot);
    const filePath = resolve(path);
    const pathFromRoot = relative(root, filePath);
    return pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot);
  }
  const root = resolve(workspaceRoot);
  const filePath = resolve(root, path);
  const pathFromRoot = relative(root, filePath);
  return pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot);
}

function matchHardDeny(toolName: string, args: unknown): string | null {
  if (toolName === "bash") {
    const command = extractBashCommand(args);
    for (const rule of HARD_DENY_PATTERNS) {
      if (rule.pattern.test(command)) {
        return rule.reason;
      }
    }
  }
  return null;
}

/** 闸门 2：取决于上下文的规则匹配。命中后进入闸门 3。 */
function matchContextRule(block: PreToolUseBlock): string | null {
  const { toolName, args, workspaceRoot } = block;
  const filePath = extractFilePath(args);

  if (toolName === "read_file") {
    if (isPathOutsideWorkspace(workspaceRoot, filePath)) {
      return `访问工作区外的文件：${filePath}`;
    }
    return null;
  }

  if (toolName === "glob") {
    const pattern = extractGlobPattern(args);
    if (isPathOutsideWorkspace(workspaceRoot, pattern)) {
      return `访问工作区外的目录：${pattern}`;
    }
    return null;
  }

  if (toolName === "write_file" || toolName === "edit_file" || toolName === "ensure_dir") {
    if (isPathOutsideWorkspace(workspaceRoot, filePath)) {
      return `尝试写入工作区外路径：${filePath}`;
    }
    return null;
  }

  if (toolName === "bash") {
    const command = extractBashCommand(args);
    if (!command.trim()) return null;
    if (/\brm\b/i.test(command)) {
      return `删除命令：${command}`;
    }
    return null;
  }

  return null;
}

/** 三道闸门顺序固定：硬拒绝 → 规则匹配 → 用户审批。 */
export function evaluatePermission(block: PreToolUseBlock): PermissionDecision {
  const hardDeny = matchHardDeny(block.toolName, block.args);
  if (hardDeny) {
    return { type: "deny", reason: hardDeny };
  }

  const ruleReason = matchContextRule(block);
  if (ruleReason) {
    return { type: "require_approval", reason: ruleReason };
  }

  return { type: "allow" };
}

export function createPermissionPreToolUseHook(): HookCallback {
  return async (block) => {
    const preBlock = block as PreToolUseBlock;
    const decision = evaluatePermission(preBlock);

    if (decision.type === "deny") {
      return { type: "stop", reason: decision.reason, toolDenied: true };
    }

    if (decision.type === "require_approval") {
      const handler = preBlock.requestToolApproval;
      if (!handler) {
        return {
          type: "stop",
          reason: `操作需要用户确认：${decision.reason}`,
          toolDenied: true,
        };
      }
      const approved = await handler({
        toolName: preBlock.toolName,
        args: preBlock.args,
        reason: decision.reason,
      });
      if (!approved) {
        return { type: "stop", reason: "用户拒绝了该工具操作。", toolDenied: true };
      }
    }

    return null;
  };
}
