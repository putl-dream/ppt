import { z } from "zod";
import {
  MAIN_AGENT_TOOL_PERMISSION_PROFILES,
} from "../../runtime/tools/tool-access-policy";
import { globWorkspaceFiles } from "../files/workspace-file-service";
import type { ToolContext, ToolDefinition } from "../tool-definition";

const fileReceiptSchema = z.object({
  path: z.string(),
  version: z.string(),
  mtimeMs: z.number(),
  size: z.number().int().nonnegative(),
  encoding: z.literal("utf8"),
  newline: z.enum(["lf", "crlf", "mixed", "none"]),
});

export const readFileSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative file path"),
});

export const readFileOutputSchema = fileReceiptSchema.extend({
  content: z.string(),
});

export const globFilesSchema = z.object({
  pattern: z.string().min(1).describe(
    "Workspace-relative glob, for example **/*.md or slides/**/*.json",
  ),
  limit: z.number().int().min(1).max(1000).optional().default(200),
});

export const globFilesOutputSchema = z.object({
  matches: z.array(z.string()),
  totalMatches: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const writeFileSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative file path"),
  content: z.string().describe("Complete text content to write"),
  expected_version: z.string().optional().describe(
    "Version returned by ReadFile. Existing files must first be read in this thread.",
  ),
});

export const writeFileOutputSchema = fileReceiptSchema.extend({
  created: z.boolean(),
  characterCount: z.number().int().nonnegative(),
});

export const editFileSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative file path"),
  old_string: z.string().min(1).describe("Exact text to replace"),
  new_string: z.string().describe("Replacement text"),
  replace_all: z.boolean().optional().describe(
    "Replace every exact match. Otherwise old_string must match exactly once.",
  ),
  expected_version: z.string().optional().describe(
    "Version returned by ReadFile. Existing files must first be read in this thread.",
  ),
});

export const editFileOutputSchema = writeFileOutputSchema.extend({
  replacements: z.number().int().positive(),
});

export const readFileTool: ToolDefinition<
  typeof readFileSchema,
  z.infer<typeof readFileOutputSchema>
> = {
  name: "ReadFile",
  description:
    "读取 workspace 内的 UTF-8 文本文件，并返回内容、版本和修改时间。"
    + "覆盖或编辑已有文件前必须先在当前 thread 调用此工具。",
  category: "core",
  loadPolicy: "core",
  inputSchema: readFileSchema,
  outputSchema: readFileOutputSchema,
  isEnabled: hasWorkspaceFileService,
  risk: "low",
  permission: MAIN_AGENT_TOOL_PERMISSION_PROFILES.ReadFile,
  execute: async (args, context) => requireFileService(context).read(args.path),
};

export const globFilesTool: ToolDefinition<
  typeof globFilesSchema,
  z.infer<typeof globFilesOutputSchema>
> = {
  name: "Glob",
  description:
    "按 workspace-relative glob 列出文件。用于在读取前发现真实路径；"
    + "不会跟随符号链接，也不会返回 workspace 外结果。",
  category: "core",
  loadPolicy: "core",
  inputSchema: globFilesSchema,
  outputSchema: globFilesOutputSchema,
  isEnabled: hasWorkspaceFileService,
  risk: "low",
  permission: MAIN_AGENT_TOOL_PERMISSION_PROFILES.Glob,
  execute: async (args, context) => {
    const matches = await globWorkspaceFiles(context.workspaceRoot!, args.pattern);
    return {
      matches: matches.slice(0, args.limit),
      totalMatches: matches.length,
      truncated: matches.length > args.limit,
    };
  },
};

export const writeFileTool: ToolDefinition<
  typeof writeFileSchema,
  z.infer<typeof writeFileOutputSchema>
> = {
  name: "WriteFile",
  description:
    "在 workspace 内创建或原子覆盖 UTF-8 文本文件。覆盖已有文件时，"
    + "必须具有当前 thread 的 ReadFile receipt；磁盘版本变化会拒绝写入。",
  category: "core",
  loadPolicy: "core",
  inputSchema: writeFileSchema,
  outputSchema: writeFileOutputSchema,
  isEnabled: hasWorkspaceFileService,
  risk: "medium",
  permission: MAIN_AGENT_TOOL_PERMISSION_PROFILES.WriteFile,
  execute: async (args, context) => requireFileService(context).write(
    args.path,
    args.content,
    { expectedVersion: args.expected_version },
  ),
};

export const editFileTool: ToolDefinition<
  typeof editFileSchema,
  z.infer<typeof editFileOutputSchema>
> = {
  name: "EditFile",
  description:
    "在已读取的 workspace 文件中执行精确文本替换。默认要求 old_string 唯一匹配；"
    + "只有显式 replace_all=true 才会替换所有匹配，版本冲突时拒绝修改。",
  category: "core",
  loadPolicy: "core",
  inputSchema: editFileSchema,
  outputSchema: editFileOutputSchema,
  isEnabled: hasWorkspaceFileService,
  risk: "medium",
  permission: MAIN_AGENT_TOOL_PERMISSION_PROFILES.EditFile,
  execute: async (args, context) => requireFileService(context).edit(
    args.path,
    args.old_string,
    args.new_string,
    {
      expectedVersion: args.expected_version,
      replaceAll: args.replace_all,
    },
  ),
};

export const workspaceFileTools = [
  globFilesTool,
  readFileTool,
  writeFileTool,
  editFileTool,
] as const;

function hasWorkspaceFileService(context: ToolContext): boolean {
  return Boolean(context.workspaceRoot && context.fileService);
}

function requireFileService(context: ToolContext) {
  if (!context.workspaceRoot || !context.fileService) {
    throw new Error("Workspace file tools require a configured workspace.");
  }
  return context.fileService;
}
