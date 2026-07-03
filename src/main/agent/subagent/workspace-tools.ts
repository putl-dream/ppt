import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { resolveWorkspacePath } from "./workspace-path";

const execFileAsync = promisify(execFile);

export interface SubAgentToolContext {
  workspaceRoot: string;
}

export interface SubAgentToolDefinition<TParams extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  inputSchema: TParams;
  execute: (args: z.infer<TParams>, context: SubAgentToolContext) => Promise<string>;
}

const readFileSchema = z.object({
  path: z.string().describe("Workspace-relative file path"),
});

const writeFileSchema = z.object({
  path: z.string().describe("Workspace-relative file path"),
  content: z.string().describe("Full file content to write"),
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
  async execute(args, context) {
    const filePath = resolveWorkspacePath(context.workspaceRoot, args.path);
    return await readFile(filePath, "utf8");
  },
};

export const writeFileTool: SubAgentToolDefinition<typeof writeFileSchema> = {
  name: "write_file",
  description: "Write or overwrite a text file in the workspace.",
  inputSchema: writeFileSchema,
  async execute(args, context) {
    const filePath = resolveWorkspacePath(context.workspaceRoot, args.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, args.content, "utf8");
    return `Wrote ${args.path} (${args.content.length} chars).`;
  },
};

export const editFileTool: SubAgentToolDefinition<typeof editFileSchema> = {
  name: "edit_file",
  description: "Replace the first occurrence of old_string with new_string in a file.",
  inputSchema: editFileSchema,
  async execute(args, context) {
    const filePath = resolveWorkspacePath(context.workspaceRoot, args.path);
    const content = await readFile(filePath, "utf8");
    const index = content.indexOf(args.old_string);
    if (index < 0) {
      throw new Error(`old_string not found in ${args.path}`);
    }
    const updated = `${content.slice(0, index)}${args.new_string}${content.slice(index + args.old_string.length)}`;
    await writeFile(filePath, updated, "utf8");
    return `Updated ${args.path}.`;
  },
};

export const globTool: SubAgentToolDefinition<typeof globSchema> = {
  name: "glob",
  description: "List workspace files matching a glob pattern.",
  inputSchema: globSchema,
  async execute(args, context) {
    const matches = await globWorkspace(context.workspaceRoot, args.pattern);
    return matches.length > 0 ? matches.join("\n") : "(no matches)";
  },
};

export const bashTool: SubAgentToolDefinition<typeof bashSchema> = {
  name: "bash",
  description: "Run a shell command with the workspace as the working directory.",
  inputSchema: bashSchema,
  async execute(args, context) {
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
  bashTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
];

export const SUB_AGENT_TOOL_HANDLERS = new Map(
  SUB_AGENT_TOOLS.map((tool) => [tool.name, tool] as const),
);

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

async function globWorkspace(workspaceRoot: string, pattern: string): Promise<string[]> {
  const matcher = globToRegExp(pattern.replace(/\\/g, "/"));
  const results: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = resolveWorkspacePath(workspaceRoot, relativeDir || ".");
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      const normalized = relativePath.replace(/\\/g, "/");
      if (matcher.test(normalized)) {
        results.push(normalized);
      }
    }
  }

  await walk("");
  return results.sort((left, right) => left.localeCompare(right));
}
