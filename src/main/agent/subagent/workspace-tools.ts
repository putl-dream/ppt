import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import {
  delimiter,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AgentGatewayConfig } from "@shared/agent-gateway-config";
import {
  ensureWorkspaceDir,
  globWorkspaceFiles,
  WorkspaceFileError,
  WorkspaceFileService,
} from "../tools/files/workspace-file-service";
import {
  SUB_AGENT_TOOL_PERMISSION_PROFILES,
  type ToolPermissionProfile,
} from "../runtime/tools/tool-access-policy";
import {
  executeWebSearch,
  formatWebSearchOutput,
  webSearchSchema,
} from "../search/web-search";

const execFileAsync = promisify(execFile);

export interface SubAgentToolContext {
  workspaceRoot: string;
  /** Session-scoped read receipts and optimistic file versions. */
  fileService?: WorkspaceFileService;
  gatewayConfig?: AgentGatewayConfig;
  signal?: AbortSignal;
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
  expected_version: z.string().optional().describe(
    "Version returned by read_file. Existing files must have been read in this session.",
  ),
});

const ensureDirSchema = z.object({
  path: z.string().describe("Workspace-relative directory path"),
});

const editFileSchema = z.object({
  path: z.string().describe("Workspace-relative file path"),
  old_string: z.string().describe("Exact text to replace"),
  new_string: z.string().describe("Replacement text"),
  replace_all: z.boolean().optional().describe(
    "Replace every exact match. Without this flag, old_string must match exactly once.",
  ),
  expected_version: z.string().optional().describe(
    "Version returned by read_file. Existing files must have been read in this session.",
  ),
});

const globSchema = z.object({
  pattern: z.string().describe("Glob pattern relative to workspace root, e.g. **/*.md"),
});

const bashSchema = z.object({
  command: z.string().describe(
    "A fail-closed workspace diagnostic command (pwd, rg, read-only git, node --check, or mkdir)",
  ),
});

export const readFileTool: SubAgentToolDefinition<typeof readFileSchema> = {
  name: "read_file",
  description: "Read a text file from the workspace.",
  inputSchema: readFileSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.read_file,
  async execute(args, context) {
    return JSON.stringify(
      await resolveFileService(context).read(args.path),
      null,
      2,
    );
  },
};

export const writeFileTool: SubAgentToolDefinition<typeof writeFileSchema> = {
  name: "write_file",
  description: "Write or overwrite a text file in the workspace. Parent directories are created automatically.",
  inputSchema: writeFileSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.write_file,
  async execute(args, context) {
    const result = await resolveFileService(context).write(args.path, args.content, {
      expectedVersion: args.expected_version,
    });
    return `Wrote ${result.path} (${result.characterCount} chars, version ${result.version}).`;
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
  description:
    "Replace an exact string in a file after reading it. Ambiguous matches are rejected "
    + "unless replace_all=true.",
  inputSchema: editFileSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.edit_file,
  async execute(args, context) {
    const result = await resolveFileService(context).edit(
      args.path,
      args.old_string,
      args.new_string,
      {
        expectedVersion: args.expected_version,
        replaceAll: args.replace_all,
      },
    );
    return `Updated ${result.path} (${result.replacements} replacement(s), `
      + `version ${result.version}).`;
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
  description:
    "Run an allowlisted workspace diagnostic without a shell. "
    + "Pipelines, redirects, arbitrary executables, and mutating build scripts are rejected.",
  inputSchema: bashSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.bash,
  async execute(args, context) {
    const mkdirPath = parseSimpleMkdirCommand(args.command);
    if (mkdirPath) {
      await ensureWorkspaceDir(context.workspaceRoot, mkdirPath);
      return `Ensured directory ${mkdirPath}.`;
    }

    const prepared = await prepareDiagnosticCommand(args.command, context);
    if ("output" in prepared) return prepared.output;
    const { stdout, stderr } = await execFileAsync(
      prepared.file,
      prepared.args,
      {
        cwd: context.workspaceRoot,
        timeout: 60_000,
        maxBuffer: 512_000,
        encoding: "utf8",
        env: {
          ...diagnosticEnvironment(context.workspaceRoot),
          ...prepared.envOverrides,
        },
        signal: context.signal,
        windowsHide: true,
      },
    );
    const output = [stdout, stderr].filter((chunk) => chunk.trim()).join("\n").trim();
    return output || "(no output)";
  },
};

export const webSearchSubAgentTool: SubAgentToolDefinition<typeof webSearchSchema> = {
  name: "web_search",
  description:
    "Search the web for current, source-backed facts and optional image candidates. "
    + "Cite factual sources; verify image licensing and retain provenance before use.",
  inputSchema: webSearchSchema,
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.web_search,
  async execute(args, context) {
    return formatWebSearchOutput(await executeWebSearch(args, {
      gatewayConfig: context.gatewayConfig,
      signal: context.signal,
    }));
  },
};

export const SUB_AGENT_TOOLS: SubAgentToolDefinition[] = [
  readFileTool,
  writeFileTool,
  ensureDirTool,
  editFileTool,
  globTool,
  bashTool,
  webSearchSubAgentTool,
];

export const SUB_AGENT_TOOL_HANDLERS = new Map(
  SUB_AGENT_TOOLS.map((tool) => [tool.name, tool] as const),
);

function resolveFileService(context: SubAgentToolContext): WorkspaceFileService {
  if (
    !context.fileService
    || context.fileService.workspaceRoot !== resolve(context.workspaceRoot)
  ) {
    context.fileService = new WorkspaceFileService(context.workspaceRoot);
  }
  return context.fileService;
}

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

type PreparedDiagnosticCommand =
  | { output: string }
  | {
    file: string;
    args: string[];
    envOverrides?: NodeJS.ProcessEnv;
  };

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "diff",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
]);

const BLOCKED_GIT_ARGUMENTS = [
  /^-c$/i,
  /^--config-env(?:=|$)/i,
  /^--exec-path(?:=|$)/i,
  /^--git-dir(?:=|$)/i,
  /^--work-tree(?:=|$)/i,
  /^--namespace(?:=|$)/i,
  /^--super-prefix(?:=|$)/i,
  /^--output(?:=|$)/i,
  /^--ext-diff$/i,
  /^--textconv$/i,
  /^--no-index$/i,
  /^--open-files-in-pager(?:=|$)/i,
  /^--paginate$/i,
  /^--pathspec-from-file(?:=|$)/i,
  /^--show-signature$/i,
  /^--verify-signatures$/i,
  /^--recurse-submodules(?:=|$)/i,
  /^--help$/i,
];

const TRUSTED_GIT_CONFIG = [
  "-c", "core.fsmonitor=false",
  "-c", "core.untrackedCache=false",
  "-c", "core.pager=cat",
  "-c", "pager.status=false",
  "-c", "pager.diff=false",
  "-c", "pager.log=false",
  "-c", "pager.show=false",
  "-c", "diff.external=",
  "-c", "diff.trustExitCode=false",
  "-c", "log.showSignature=false",
  "-c", "commit.gpgSign=false",
];

const RG_BOOLEAN_OPTIONS = new Set([
  "-0",
  "-F",
  "-i",
  "-l",
  "-n",
  "-s",
  "-S",
  "-w",
  "-x",
  "--case-sensitive",
  "--count",
  "--count-matches",
  "--files",
  "--files-with-matches",
  "--files-without-match",
  "--fixed-strings",
  "--heading",
  "--hidden",
  "--ignore-case",
  "--json",
  "--line-number",
  "--line-regexp",
  "--no-heading",
  "--no-hidden",
  "--no-ignore",
  "--no-ignore-vcs",
  "--null",
  "--smart-case",
  "--stats",
  "--trim",
  "--word-regexp",
]);

const RG_VALUE_OPTIONS = new Map<string, "glob" | "type" | "number">([
  ["-A", "number"],
  ["--after-context", "number"],
  ["-B", "number"],
  ["--before-context", "number"],
  ["-C", "number"],
  ["--context", "number"],
  ["-g", "glob"],
  ["--glob", "glob"],
  ["-m", "number"],
  ["--max-count", "number"],
  ["--max-depth", "number"],
  ["--max-filesize", "number"],
  ["-t", "type"],
  ["--type", "type"],
  ["-T", "type"],
  ["--type-not", "type"],
]);

async function prepareDiagnosticCommand(
  command: string,
  context: SubAgentToolContext,
): Promise<PreparedDiagnosticCommand> {
  const tokens = tokenizeDirectCommand(command);
  if (tokens.length === 0) {
    throw unsafeCommand("Command is required.");
  }
  const executable = tokens[0]!.toLowerCase();
  if (executable === "pwd" && tokens.length === 1) {
    return { output: resolve(context.workspaceRoot) };
  }
  if (executable === "node") {
    if (
      tokens.length !== 3
      || (tokens[1] !== "--check" && tokens[1] !== "-c")
    ) {
      throw unsafeCommand("Only `node --check <workspace-file>` is allowed.");
    }
    const relativePath = assertSafeRelativeCommandPath(tokens[2]!);
    await resolveFileService(context).read(relativePath);
    return {
      file: process.execPath,
      args: ["--check", resolve(context.workspaceRoot, relativePath)],
      // Electron's executable becomes a Node-compatible CLI only under this
      // documented runtime switch; regular Node safely ignores it.
      envOverrides: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  if (executable === "git") {
    return await prepareReadOnlyGit(tokens.slice(1), context);
  }
  if (executable === "rg" || executable === "ripgrep") {
    return prepareRipgrep(tokens.slice(1));
  }
  throw unsafeCommand(
    `Executable is not allowlisted: ${tokens[0]}. `
    + "Use dedicated file tools for mutations.",
  );
}

async function prepareReadOnlyGit(
  args: string[],
  context: SubAgentToolContext,
): Promise<PreparedDiagnosticCommand> {
  if (args.length === 1 && args[0] === "--version") {
    return { file: "git", args };
  }
  const subcommand = args[0]?.toLowerCase();
  if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    throw unsafeCommand(
      "Only read-only git status/diff/log/show/rev-parse/ls-files operations are allowed.",
    );
  }
  const commandArgs = args.slice(1);
  for (const argument of commandArgs) {
    if (BLOCKED_GIT_ARGUMENTS.some((pattern) => pattern.test(argument))) {
      throw unsafeCommand(`Unsafe git option is not allowed: ${argument}`);
    }
    if (/%G[A-Z?]/.test(argument)) {
      throw unsafeCommand("Git signature format placeholders may invoke an external verifier.");
    }
    assertNoOutsidePathToken(argument);
  }
  await assertSafeGitRepository(context);

  const safetyOptions = [
    ...(["diff", "log", "show"].includes(subcommand)
      ? ["--no-ext-diff", "--no-textconv"]
      : []),
    ...(["diff", "log", "show", "status"].includes(subcommand)
      ? ["--ignore-submodules=all"]
      : []),
  ];
  return {
    file: "git",
    args: [...TRUSTED_GIT_CONFIG, subcommand, ...safetyOptions, ...commandArgs],
  };
}

async function assertSafeGitRepository(
  context: SubAgentToolContext,
): Promise<void> {
  const workspaceRoot = resolve(context.workspaceRoot);
  const gitDirectory = resolve(workspaceRoot, ".git");
  let gitStats;
  try {
    gitStats = await lstat(gitDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw unsafeCommand(
        "Git diagnostics require a real .git directory inside the workspace; parent repositories are not used.",
      );
    }
    throw error;
  }
  if (gitStats.isSymbolicLink() || !gitStats.isDirectory()) {
    throw unsafeCommand("Linked .git directories and external worktree metadata are not allowed.");
  }
  const canonicalGitDirectory = await realpath(gitDirectory);
  if (relative(gitDirectory, canonicalGitDirectory) !== "") {
    throw unsafeCommand("The .git directory must be physically contained in the workspace.");
  }

  const fileService = resolveFileService(context);
  const config = (await fileService.read(".git/config")).content;
  const meaningfulConfig = config
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#")
      && !line.trimStart().startsWith(";"))
    .join("\n");
  if (
    /^\s*\[(?:include(?:if)?|filter|diff|credential|gpg|pager|difftool|mergetool)\b/im
      .test(meaningfulConfig)
    || /^\s*(?:fsmonitor|hookspath|sshcommand|attributesfile|excludesfile|external|textconv|command|process|clean|smudge|helper|program|worktreeconfig)\s*=/im
      .test(meaningfulConfig)
  ) {
    throw unsafeCommand(
      "Repository-local config contains an external helper or include and is not safe for unattended diagnostics.",
    );
  }

  if (await commandPathExists(resolve(gitDirectory, "objects/info/alternates"))) {
    throw unsafeCommand("Git object alternates outside the workspace are not allowed.");
  }
  if (await commandPathExists(resolve(gitDirectory, "config.worktree"))) {
    throw unsafeCommand("Per-worktree Git config is not allowed for unattended diagnostics.");
  }

  const { stdout } = await execFileAsync(
    "git",
    [
      ...TRUSTED_GIT_CONFIG,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--",
      ".gitattributes",
      "**/.gitattributes",
    ],
    {
      cwd: workspaceRoot,
      timeout: 30_000,
      maxBuffer: 512_000,
      encoding: "utf8",
      env: diagnosticEnvironment(workspaceRoot),
      signal: context.signal,
      windowsHide: true,
    },
  );
  const attributePaths = stdout.split("\0").filter(Boolean);
  if (attributePaths.length > 256) {
    throw unsafeCommand("Too many .gitattributes files to verify safely.");
  }
  if (await commandPathExists(resolve(gitDirectory, "info/attributes"))) {
    attributePaths.push(".git/info/attributes");
  }
  for (const attributePath of attributePaths) {
    assertSafeRelativeCommandPath(attributePath);
    const attributes = (await fileService.read(attributePath)).content;
    if (containsExternalGitAttribute(attributes)) {
      throw unsafeCommand(
        `Git attributes may activate an external filter or diff driver: ${attributePath}`,
      );
    }
  }
}

function containsExternalGitAttribute(content: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const attributes = trimmed.split(/\s+/).slice(1);
    if (attributes.some((attribute) =>
      /^(?:[-!]?(?:filter|diff|merge)|(?:filter|diff|merge|working-tree-encoding)=)/i
        .test(attribute),
    )) {
      return true;
    }
  }
  return false;
}

async function commandPathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function prepareRipgrep(args: string[]): PreparedDiagnosticCommand {
  let filesMode = false;
  let pattern: string | undefined;
  const safeArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") {
      if (index !== args.length - 2 || pattern !== undefined) {
        throw unsafeCommand("ripgrep accepts exactly one pattern and no custom search root.");
      }
      pattern = args[index + 1]!;
      index += 1;
      continue;
    }
    if (RG_BOOLEAN_OPTIONS.has(argument)) {
      filesMode ||= argument === "--files";
      safeArgs.push(argument);
      continue;
    }
    const valueKind = RG_VALUE_OPTIONS.get(argument);
    if (valueKind) {
      const value = args[index + 1];
      if (value === undefined) {
        throw unsafeCommand(`Missing value for ripgrep option ${argument}.`);
      }
      validateRipgrepOptionValue(valueKind, value);
      safeArgs.push(argument, value);
      index += 1;
      continue;
    }
    const attached = parseAttachedRipgrepOption(argument);
    if (attached) {
      validateRipgrepOptionValue(attached.kind, attached.value);
      safeArgs.push(argument);
      continue;
    }
    if (argument.startsWith("-")) {
      throw unsafeCommand(`ripgrep option is not allowlisted: ${argument}`);
    }
    if (pattern !== undefined) {
      throw unsafeCommand(
        "Custom ripgrep search roots are not allowed; use --glob to narrow the workspace.",
      );
    }
    pattern = argument;
  }

  if (filesMode && pattern !== undefined) {
    throw unsafeCommand("`rg --files` does not accept a search pattern in this policy.");
  }
  if (!filesMode && pattern === undefined) {
    throw unsafeCommand("ripgrep requires one search pattern.");
  }
  return {
    file: "rg",
    args: [
      "--no-config",
      "--no-follow",
      "--color=never",
      ...safeArgs,
      ...(pattern === undefined ? [] : ["--", pattern]),
      ".",
    ],
  };
}

function parseAttachedRipgrepOption(
  argument: string,
): { kind: "glob" | "type" | "number"; value: string } | undefined {
  for (const [prefix, kind] of RG_VALUE_OPTIONS) {
    if (
      prefix.startsWith("-")
      && !prefix.startsWith("--")
      && argument.startsWith(prefix)
      && argument.length > prefix.length
    ) {
      return { kind, value: argument.slice(prefix.length) };
    }
    if (prefix.startsWith("--") && argument.startsWith(`${prefix}=`)) {
      return { kind, value: argument.slice(prefix.length + 1) };
    }
  }
  return undefined;
}

function validateRipgrepOptionValue(
  kind: "glob" | "type" | "number",
  value: string,
): void {
  if (!value || value.includes("\0")) {
    throw unsafeCommand("ripgrep option values must not be empty.");
  }
  if (kind === "number" && !/^\d+(?:[KMG])?$/i.test(value)) {
    throw unsafeCommand(`Invalid numeric ripgrep option value: ${value}`);
  }
  if (kind === "type" && !/^[a-z0-9_-]+$/i.test(value)) {
    throw unsafeCommand(`Invalid ripgrep file type: ${value}`);
  }
  if (kind === "glob") {
    assertNoOutsidePathToken(value.replace(/^!/, ""));
  }
}

function tokenizeDirectCommand(command: string): string[] {
  if (
    !command.trim()
    || command.length > 16_384
    || /[\0\r\n;&|<>`]/.test(command)
    || /\$\(|\$\{/.test(command)
  ) {
    throw unsafeCommand(
      "Shell operators, substitutions, multiline input, and oversized commands are not allowed.",
    );
  }

  const tokens: string[] = [];
  let token = "";
  let quote: "'" | "\"" | undefined;
  let tokenStarted = false;
  for (const character of command.trim()) {
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    token += character;
    tokenStarted = true;
  }
  if (quote) throw unsafeCommand("Unclosed command quote.");
  if (tokenStarted) tokens.push(token);
  if (tokens.length > 256) throw unsafeCommand("Command has too many arguments.");
  return tokens;
}

function assertSafeRelativeCommandPath(path: string): string {
  assertNoOutsidePathToken(path);
  if (!path || path.startsWith("-")) {
    throw unsafeCommand(`Invalid workspace path: ${path}`);
  }
  return path;
}

function assertNoOutsidePathToken(value: string): void {
  if (
    isAbsolute(value)
    || /^[a-z]:[\\/]/i.test(value)
    || value.split(/[\\/]+/).includes("..")
  ) {
    throw unsafeCommand(`Path traversal is not allowed in diagnostic commands: ${value}`);
  }
}

function diagnosticEnvironment(workspaceRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CI: "1",
    NO_COLOR: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_EXTERNAL_DIFF: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  };
  for (const name of [
    "LANG",
    "LC_ALL",
    "SystemRoot",
    "WINDIR",
    "PATHEXT",
    "TEMP",
    "TMP",
    "TMPDIR",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  const safePath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => {
      if (!entry || !isAbsolute(entry)) return false;
      const fromRoot = relative(resolve(workspaceRoot), resolve(entry));
      return fromRoot.startsWith("..") || isAbsolute(fromRoot);
    })
    .join(delimiter);
  if (safePath) environment.PATH = safePath;
  return environment;
}

function unsafeCommand(message: string): WorkspaceFileError {
  return new WorkspaceFileError("UNSAFE_COMMAND", message);
}
