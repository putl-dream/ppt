import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  editWorkspaceText,
  ensureWorkspaceDir,
  globWorkspaceFiles,
  readWorkspaceText,
  writeWorkspaceText,
} from "./workspace-file-ops";
import { isOutsideWorkspace } from "./workspace-path";
import {
  SUB_AGENT_TOOL_PERMISSION_PROFILES,
  type ToolPermissionProfile,
} from "../runtime/tool-access-policy";

const execFileAsync = promisify(execFile);

export interface SubAgentToolContext {
  workspaceRoot: string;
}

export interface SubAgentToolDefinition<TParams extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  inputSchema: TParams;
  permission: ToolPermissionProfile;
  execute: (args: z.infer<TParams>, context: SubAgentToolContext) => Promise<string>;
}

const readFileSchema = z.object({
  path: z.string().describe("Workspace-relative file path"),
});

const writeFileSchema = z.object({
  path: z.string().describe("Workspace-relative file path"),
  content: z.string().describe("Full file content to write"),
});

const ensureDirSchema = z.object({
  path: z.string().describe("Workspace-relative directory path"),
});

const editFileSchema = z.object({
  path: z.string().describe("Workspace-relative file path"),
  old_string: z.string().describe("Exact text to replace"),
  new_string: z.string().describe("Replacement text"),
});

const globSchema = z.object({
  pattern: z.string().describe("Glob pattern relative to workspace root, e.g. **/*.md"),
});

const bashSchema = z.object({
  command: z.string().describe("Shell command to run in the workspace directory"),
});

export const readFileTool: SubAgentToolDefinition<typeof readFileSchema> = {
  name: "read_file",
  description: "Read a text file from the workspace.",
  inputSchema: readFileSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.read_file,
  async execute(args, context) {
    return await readWorkspaceText(context.workspaceRoot, args.path);
  },
};

export const writeFileTool: SubAgentToolDefinition<typeof writeFileSchema> = {
  name: "write_file",
  description: "Write or overwrite a text file in the workspace. Parent directories are created automatically.",
  inputSchema: writeFileSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.write_file,
  async execute(args, context) {
    await writeWorkspaceText(context.workspaceRoot, args.path, args.content);
    return `Wrote ${args.path} (${args.content.length} chars).`;
  },
};

export const ensureDirTool: SubAgentToolDefinition<typeof ensureDirSchema> = {
  name: "ensure_dir",
  description: "Create a workspace directory if it does not already exist.",
  inputSchema: ensureDirSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.ensure_dir,
  async execute(args, context) {
    await ensureWorkspaceDir(context.workspaceRoot, args.path);
    return `Ensured directory ${args.path}.`;
  },
};

export const editFileTool: SubAgentToolDefinition<typeof editFileSchema> = {
  name: "edit_file",
  description: "Replace the first occurrence of old_string with new_string in a file.",
  inputSchema: editFileSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.edit_file,
  async execute(args, context) {
    await editWorkspaceText(context.workspaceRoot, args.path, args.old_string, args.new_string);
    return `Updated ${args.path}.`;
  },
};

export const globTool: SubAgentToolDefinition<typeof globSchema> = {
  name: "glob",
  description: "List workspace files matching a glob pattern.",
  inputSchema: globSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.glob,
  async execute(args, context) {
    const matches = await globWorkspaceFiles(context.workspaceRoot, args.pattern);
    return matches.length > 0 ? matches.join("\n") : "(no matches)";
  },
};

export const bashTool: SubAgentToolDefinition<typeof bashSchema> = {
  name: "bash",
  description: "Run a non-file-system shell command with the workspace as the working directory.",
  inputSchema: bashSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.bash,
  async execute(args, context) {
    const mkdirPath = parseSimpleMkdirCommand(args.command);
    if (mkdirPath) {
      if (isOutsideWorkspace(context.workspaceRoot, mkdirPath)) {
        throw new Error(`mkdir path is outside the workspace sandbox: ${mkdirPath}`);
      }
      await ensureWorkspaceDir(context.workspaceRoot, mkdirPath);
      return `Ensured directory ${mkdirPath}.`;
    }

    const { stdout, stderr } = await execFileAsync(
      process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      process.platform === "win32" ? ["/c", args.command] : ["-c", args.command],
      {
        cwd: context.workspaceRoot,
        timeout: 60_000,
        maxBuffer: 512_000,
        env: { ...process.env, CI: "1" },
      },
    );
    const output = [stdout, stderr].filter((chunk) => chunk.trim()).join("\n").trim();
    return output || "(no output)";
  },
};

export const SUB_AGENT_TOOLS: SubAgentToolDefinition[] = [
  readFileTool,
  writeFileTool,
  ensureDirTool,
  editFileTool,
  globTool,
  bashTool,
];

export const SUB_AGENT_TOOL_HANDLERS = new Map(
  SUB_AGENT_TOOLS.map((tool) => [tool.name, tool] as const),
);

function parseSimpleMkdirCommand(command: string): string | null {
  const match = command.trim().match(/^mkdir(?:\s+-p)?\s+("[^"]+"|'[^']+'|[^\s"'<>|&;]+)\s*$/i);
  if (!match) return null;
  const rawPath = match[1]!;
  const path = stripMatchingQuotes(rawPath);
  if (!path.trim()) return null;
  return path;
}

function stripMatchingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
