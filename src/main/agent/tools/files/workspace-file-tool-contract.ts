import { z } from "zod";
import { normalize, posix, resolve } from "node:path";
import {
  WORKSPACE_FILE_TOOL_PERMISSION_PROFILES,
  type ToolPermissionProfile,
  type ToolRisk,
} from "../../runtime/tools/tool-access-policy";
import {
  globWorkspaceFiles,
  countOccurrences,
  WorkspaceFileError,
  type WorkspaceFileService,
} from "./workspace-file-service";
import type {
  PptLifecycleToolBridge,
  ToolRuntimeBehavior,
} from "../tool-definition";
import {
  isSvgDeckLockPath,
  validateSvgDeckLockContent,
} from "../core/svg-deck-locks";

export interface WorkspaceFileToolContext {
  readonly workspaceRoot?: string;
  readonly fileService?: WorkspaceFileService;
  readonly presentationLifecycle?: Pick<
    PptLifecycleToolBridge,
    "observeArtifactChanges"
  >;
}

export interface WorkspaceFileToolContract<
  TParams extends z.ZodObject<any> = z.ZodObject<any>,
  TResult = unknown,
> {
  name: "Glob" | "ReadFile" | "WriteFile" | "EditFile";
  description: string;
  inputSchema: TParams;
  outputSchema: z.ZodType<TResult>;
  formatResultForModel?: (result: TResult) => string;
  behavior?: ToolRuntimeBehavior<z.infer<TParams>>;
  risk: ToolRisk;
  permission: ToolPermissionProfile;
  isEnabled: (context: WorkspaceFileToolContext) => boolean;
  execute: (
    args: z.infer<TParams>,
    context: WorkspaceFileToolContext,
  ) => Promise<TResult>;
}

export const fileReceiptSchema = z.object({
  path: z.string(),
  version: z.string(),
  mtimeMs: z.number(),
  size: z.number().int().nonnegative(),
  encoding: z.literal("utf8"),
  newline: z.enum(["lf", "crlf", "mixed", "none"]),
});

export const readFileSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative file path"),
  offset: z.number().int().min(0).optional().describe(
    "Zero-based text offset. For continuation, pass nextOffset from the previous result.",
  ),
  limit: z.number().int().min(2).max(4_000).optional().describe(
    "Maximum UTF-16 text units to return in this window.",
  ),
  expected_version: z.string().optional().describe(
    "Required when offset > 0. Pass version from the first window to prevent mixed-version reads.",
  ),
});

export const readFileOutputSchema = fileReceiptSchema.extend({
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  totalCharacters: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nonnegative().optional(),
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

export const readFileContract: WorkspaceFileToolContract<
  typeof readFileSchema,
  z.infer<typeof readFileOutputSchema>
> = {
  name: "ReadFile",
  description:
    "分页读取 workspace 内的 UTF-8 文本文件，并返回内容窗口、版本和续读位置。"
    + "hasMore=true 时必须用 nextOffset 和同一 version 继续读取，直到 hasMore=false。"
    + "只有完整读取同一版本后，才可覆盖或编辑已有文件。",
  inputSchema: readFileSchema,
  outputSchema: readFileOutputSchema,
  formatResultForModel: formatReadFileResultForModel,
  risk: "low",
  permission: WORKSPACE_FILE_TOOL_PERMISSION_PROFILES.ReadFile,
  behavior: workspacePathParallelBehavior(),
  isEnabled: hasWorkspaceFileService,
  execute: async (args, context) => {
    await observeArtifactChange(context, [args.path], "agent_read");
    return requireFileService(context).readWindow(args.path, {
      offset: args.offset,
      limit: args.limit,
      expectedVersion: args.expected_version,
    });
  },
};

export const globFilesContract: WorkspaceFileToolContract<
  typeof globFilesSchema,
  z.infer<typeof globFilesOutputSchema>
> = {
  name: "Glob",
  description:
    "按 workspace-relative glob 列出文件。用于在读取前发现真实路径；"
    + "不会跟随符号链接，也不会返回 workspace 外结果。",
  inputSchema: globFilesSchema,
  outputSchema: globFilesOutputSchema,
  risk: "low",
  permission: WORKSPACE_FILE_TOOL_PERMISSION_PROFILES.Glob,
  isEnabled: hasWorkspaceFileService,
  execute: async (args, context) => {
    const matches = await globWorkspaceFiles(context.workspaceRoot!, args.pattern);
    await observeArtifactChange(context, matches, "capability_probe");
    return {
      matches: matches.slice(0, args.limit),
      totalMatches: matches.length,
      truncated: matches.length > args.limit,
    };
  },
};

export const writeFileContract: WorkspaceFileToolContract<
  typeof writeFileSchema,
  z.infer<typeof writeFileOutputSchema>
> = {
  name: "WriteFile",
  description:
    "在 workspace 内创建或原子覆盖 UTF-8 文本文件。覆盖已有文件时，"
    + "必须具有当前 thread 的 ReadFile receipt；磁盘版本变化会拒绝写入。"
    + "写入 design/design-spec.json 或 slides/page-plan.json 时会按 SVG deck 锁契约做硬校验，非法内容不落盘。",
  inputSchema: writeFileSchema,
  outputSchema: writeFileOutputSchema,
  behavior: {
    ...workspacePathParallelBehavior(),
    presentation: {
      allowedCapabilities: ["create", "edit", "restyle"],
      isRequired: (args) => isPresentationOwnedWorkspacePath(args.path),
    },
  },
  risk: "medium",
  permission: WORKSPACE_FILE_TOOL_PERMISSION_PROFILES.WriteFile,
  isEnabled: hasWorkspaceFileService,
  execute: async (args, context) => {
    assertSvgDeckLockContentIfNeeded(args.path, args.content);
    const result = await requireFileService(context).write(
      args.path,
      args.content,
      { expectedVersion: args.expected_version },
    );
    await observeArtifactChange(context, [result.path], "agent_write");
    return result;
  },
};

export const editFileContract: WorkspaceFileToolContract<
  typeof editFileSchema,
  z.infer<typeof editFileOutputSchema>
> = {
  name: "EditFile",
  description:
    "在已读取的 workspace 文件中执行精确文本替换。默认要求 old_string 唯一匹配；"
    + "只有显式 replace_all=true 才会替换所有匹配，版本冲突时拒绝修改。"
    + "编辑 design/design-spec.json 或 slides/page-plan.json 时，替换后的完整内容必须满足 SVG deck 锁契约。",
  inputSchema: editFileSchema,
  outputSchema: editFileOutputSchema,
  behavior: {
    ...workspacePathParallelBehavior(),
    presentation: {
      allowedCapabilities: ["create", "edit", "restyle"],
      isRequired: (args) => isPresentationOwnedWorkspacePath(args.path),
    },
  },
  risk: "medium",
  permission: WORKSPACE_FILE_TOOL_PERMISSION_PROFILES.EditFile,
  isEnabled: hasWorkspaceFileService,
  execute: async (args, context) => {
    const fileService = requireFileService(context);
    if (isSvgDeckLockPath(args.path)) {
      const current = await fileService.inspect(args.path);
      const replacements = countOccurrences(current.content, args.old_string);
      if (replacements === 0) {
        throw new WorkspaceFileError(
          "OLD_STRING_NOT_FOUND",
          `old_string not found in ${args.path}`,
        );
      }
      if (!args.replace_all && replacements > 1) {
        throw new WorkspaceFileError(
          "AMBIGUOUS_EDIT",
          `old_string matches ${replacements} locations in ${args.path}; `
          + "provide more context or set replace_all=true.",
        );
      }
      const updated = args.replace_all
        ? current.content.split(args.old_string).join(args.new_string)
        : current.content.replace(args.old_string, args.new_string);
      assertSvgDeckLockContentIfNeeded(args.path, updated);
    }
    const result = await fileService.edit(
      args.path,
      args.old_string,
      args.new_string,
      {
        expectedVersion: args.expected_version,
        replaceAll: args.replace_all,
      },
    );
    await observeArtifactChange(context, [result.path], "agent_write");
    return result;
  },
};

export const workspaceFileToolContracts = [
  globFilesContract,
  readFileContract,
  writeFileContract,
  editFileContract,
] as const;

function hasWorkspaceFileService(context: WorkspaceFileToolContext): boolean {
  return Boolean(context.workspaceRoot && context.fileService);
}

function workspacePathParallelBehavior(): ToolRuntimeBehavior<{ path: string }> {
  return {
    concurrency: {
      mode: "parallel",
      conflictScope: "workspace_path",
      resourceKeys: (args, context) => {
        const absolute = normalize(resolve(context.workspaceRoot ?? ".", args.path));
        return [`workspace-path:${process.platform === "win32" ? absolute.toLowerCase() : absolute}`];
      },
    },
  };
}

function isPresentationOwnedWorkspacePath(input: string): boolean {
  const path = posix.normalize(input.replace(/\\/g, "/"))
    .replace(/^\.\//, "")
    .toLowerCase();
  return path === "design/design-spec.json"
    || path === "slides/page-plan.json"
    || path === "slides/storyboard.json"
    || path === "slides/layout-plan.json"
    || path === "slides/layout-choice.json"
    || path === "slides/layout-input.json"
    || path === "deck/snapshot.json"
    || path.startsWith("slides/svg/")
    || path.startsWith("assets/");
}

function requireFileService(context: WorkspaceFileToolContext): WorkspaceFileService {
  if (!context.workspaceRoot || !context.fileService) {
    throw new Error("Workspace file tools require a configured workspace.");
  }
  return context.fileService;
}

async function observeArtifactChange(
  context: WorkspaceFileToolContext,
  paths: readonly string[],
  source: "capability_probe" | "agent_read" | "agent_write",
): Promise<void> {
  if (!context.workspaceRoot || !context.presentationLifecycle) return;
  await context.presentationLifecycle.observeArtifactChanges({
    workspaceRoot: context.workspaceRoot,
    paths,
    source,
  });
}

function assertSvgDeckLockContentIfNeeded(path: string, content: string): void {
  if (!isSvgDeckLockPath(path)) return;
  try {
    validateSvgDeckLockContent(path, content);
  } catch (error) {
    throw new WorkspaceFileError(
      "LOCK_SCHEMA_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function formatReadFileResultForModel(
  result: z.infer<typeof readFileOutputSchema>,
): string {
  const metadata = JSON.stringify({
    path: result.path,
    version: result.version,
    mtimeMs: result.mtimeMs,
    size: result.size,
    encoding: result.encoding,
    newline: result.newline,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    totalCharacters: result.totalCharacters,
    hasMore: result.hasMore,
    ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}),
  });
  return [
    metadata,
    "---BEGIN EXACT FILE CONTENT---",
    result.content,
    "---END EXACT FILE CONTENT---",
  ].join("\n");
}
