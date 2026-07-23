import { isAbsolute, relative, resolve } from "node:path";

export type ToolRisk = "low" | "medium" | "high";

export type ToolPermissionScope = "main" | "subagent";

export type ToolPermissionEffect =
  | "presentation.read"
  | "presentation.propose"
  | "workspace.read"
  | "workspace.write"
  | "process.execute"
  | "workflow.delegate"
  | "user.interaction"
  | "skill.load"
  | "network.access";

export type ToolPermissionApproval = "never" | "contextual" | "always";

export type ToolPermissionSandbox = "none" | "presentation" | "workspace";

export interface ToolPermissionProfile {
  profile: string;
  description: string;
  scopes: ToolPermissionScope[];
  effects: ToolPermissionEffect[];
  sandbox: ToolPermissionSandbox;
  approval: ToolPermissionApproval;
  workspacePathArg?: "path" | "pattern";
  shellCommandArg?: "command";
}

export type PermissionDecision =
  | { type: "allow" }
  | { type: "deny"; reason: string }
  | { type: "require_approval"; reason: string };

export interface ToolPermissionBlock {
  toolName: string;
  args: unknown;
  scope?: ToolPermissionScope;
  workspaceRoot?: string;
}

export const SUB_AGENT_TOOL_PERMISSION_PROFILES = {
  read_file: {
    profile: "workspace-read",
    description: "Read a text file from the configured workspace sandbox.",
    scopes: ["subagent"],
    effects: ["workspace.read"],
    sandbox: "workspace",
    approval: "contextual",
    workspacePathArg: "path",
  },
  glob: {
    profile: "workspace-read",
    description: "List files in the configured workspace sandbox.",
    scopes: ["subagent"],
    effects: ["workspace.read"],
    sandbox: "workspace",
    approval: "contextual",
    workspacePathArg: "pattern",
  },
  write_file: {
    profile: "workspace-write",
    description: "Create or overwrite a text file in the configured workspace sandbox.",
    scopes: ["subagent"],
    effects: ["workspace.write"],
    sandbox: "workspace",
    approval: "contextual",
    workspacePathArg: "path",
  },
  edit_file: {
    profile: "workspace-write",
    description: "Edit an existing text file in the configured workspace sandbox.",
    scopes: ["subagent"],
    effects: ["workspace.read", "workspace.write"],
    sandbox: "workspace",
    approval: "contextual",
    workspacePathArg: "path",
  },
  ensure_dir: {
    profile: "workspace-write",
    description: "Create a directory in the configured workspace sandbox.",
    scopes: ["subagent"],
    effects: ["workspace.write"],
    sandbox: "workspace",
    approval: "contextual",
    workspacePathArg: "path",
  },
  bash: {
    profile: "workspace-shell",
    description: "Run a shell command with the workspace as cwd.",
    scopes: ["subagent"],
    effects: ["process.execute"],
    sandbox: "workspace",
    approval: "contextual",
    shellCommandArg: "command",
  },
  web_search: {
    profile: "web-search",
    description: "Send a query to the configured web search provider.",
    scopes: ["subagent"],
    effects: ["network.access"],
    sandbox: "none",
    approval: "never",
  },
} satisfies Record<string, ToolPermissionProfile>;

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

export function isRiskApprovalHintRequired(risk: ToolRisk): boolean {
  return risk === "medium" || risk === "high";
}

export function getToolPermissionProfile(toolName: string): ToolPermissionProfile | undefined {
  return SUB_AGENT_TOOL_PERMISSION_PROFILES[
    toolName as keyof typeof SUB_AGENT_TOOL_PERMISSION_PROFILES
  ];
}

export function isPathOutsideWorkspace(workspaceRoot: string | undefined, path: string): boolean {
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

export function evaluateToolPermission(block: ToolPermissionBlock): PermissionDecision {
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

function matchHardDeny(toolName: string, args: unknown): string | null {
  const profile = getToolPermissionProfile(toolName);
  const command = extractStringArg(args, profile?.shellCommandArg);
  if (!command) return null;

  for (const rule of HARD_DENY_PATTERNS) {
    if (rule.pattern.test(command)) {
      return rule.reason;
    }
  }
  return null;
}

function matchContextRule(block: ToolPermissionBlock): string | null {
  const profile = getToolPermissionProfile(block.toolName);
  if (!profile) return null;

  const workspacePath = extractStringArg(block.args, profile.workspacePathArg);
  if (workspacePath && isPathOutsideWorkspace(block.workspaceRoot, workspacePath)) {
    return formatOutsideWorkspaceReason(block.toolName, profile, workspacePath);
  }

  const command = extractStringArg(block.args, profile.shellCommandArg);
  if (command && /\brm\b/i.test(command)) {
    return `删除命令：${command}`;
  }

  return null;
}

function extractStringArg(args: unknown, key: string | undefined): string {
  if (!key || !args || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function formatOutsideWorkspaceReason(
  toolName: string,
  profile: ToolPermissionProfile,
  path: string,
): string {
  if (toolName === "glob") {
    return `访问工作区外的目录：${path}`;
  }
  if (profile.effects.includes("workspace.write")) {
    return `尝试写入工作区外路径：${path}`;
  }
  return `访问工作区外的文件：${path}`;
}
