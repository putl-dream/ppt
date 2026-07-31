import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  constants,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";
import {
  AtomicWriteConflictError,
  withAtomicFileTransaction,
  writeTextFileAtomic,
  type AtomicCommitGuard,
  type AtomicFileIdentity,
} from "../../persistence/atomic-json-file";

export type WorkspaceFileErrorCode =
  | "OUTSIDE_WORKSPACE"
  | "READ_REQUIRED"
  | "STALE_FILE"
  | "INVALID_EXPECTED_VERSION"
  | "INVALID_EDIT"
  | "OLD_STRING_NOT_FOUND"
  | "AMBIGUOUS_EDIT"
  | "UNSAFE_FILE_TYPE"
  | "INVALID_UTF8"
  | "FILE_TOO_LARGE"
  | "INVALID_READ_RANGE"
  | "UNSAFE_COMMAND"
  | "LOCK_SCHEMA_INVALID";

export class WorkspaceFileError extends Error {
  constructor(
    readonly code: WorkspaceFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceFileError";
  }
}

export interface WorkspaceFileReceipt {
  /** Canonical workspace-relative path. */
  path: string;
  /** Content-addressed optimistic concurrency token. */
  version: string;
  /** Last-modified time observed with this exact content. */
  mtimeMs: number;
  /** UTF-8 byte length of the complete file. */
  size: number;
  encoding: "utf8";
  newline: "lf" | "crlf" | "mixed" | "none";
}

export interface WorkspaceFileReadResult extends WorkspaceFileReceipt {
  content: string;
}

export interface WorkspaceFileReadOptions {
  maxBytes?: number;
}

export interface WorkspaceFileWindowReadOptions extends WorkspaceFileReadOptions {
  offset?: number;
  limit?: number;
  expectedVersion?: string;
}

export interface WorkspaceFileWindowReadResult extends WorkspaceFileReceipt {
  content: string;
  startOffset: number;
  endOffset: number;
  totalCharacters: number;
  hasMore: boolean;
  nextOffset?: number;
}

export interface WorkspaceFileWriteOptions {
  expectedVersion?: string;
}

export interface WorkspaceFileWriteResult extends WorkspaceFileReceipt {
  created: boolean;
  characterCount: number;
}

export interface WorkspaceFileEditOptions extends WorkspaceFileWriteOptions {
  replaceAll?: boolean;
}

export interface WorkspaceFileEditResult extends WorkspaceFileWriteResult {
  replacements: number;
}

interface StableFileSnapshot {
  absolutePath: string;
  content: string;
  version: string;
  mtimeMs: number;
  size: number;
  mode: number;
  dev: number;
  ino: number;
  ctimeMs: number;
}

interface GuardedDirectoryIdentity {
  path: string;
  dev: number;
  ino: number;
}

interface WorkspacePathGuard {
  canonicalRoot: string;
  directories: GuardedDirectoryIdentity[];
  validate: () => Promise<void>;
}

interface ObservedFileCoverage {
  version: string;
  ranges: Array<{ start: number; end: number }>;
}

const FILE_MUTATION_LOCKS = new Map<string, Promise<void>>();

/**
 * Runtime-scoped text-file service shared by main agents and teammates.
 *
 * Existing files may only be mutated after this service instance has read the
 * same canonical file. The read receipt and the current on-disk snapshot are
 * compared immediately before every atomic replacement.
 */
export class WorkspaceFileService {
  readonly workspaceRoot: string;

  private readonly receipts = new Map<string, WorkspaceFileReceipt>();
  private readonly receiptSnapshots = new Map<string, StableFileSnapshot>();
  private readonly observedCoverage = new Map<string, ObservedFileCoverage>();

  constructor(workspaceRoot: string) {
    if (!workspaceRoot.trim()) {
      throw new Error("Workspace root is required.");
    }
    this.workspaceRoot = resolve(workspaceRoot);
  }

  async read(
    path: string,
    options: WorkspaceFileReadOptions = {},
  ): Promise<WorkspaceFileReadResult> {
    const snapshot = await this.readSnapshot(path, options);
    const receipt = this.recordReceipt(snapshot);
    return {
      ...receipt,
      content: snapshot.content,
    };
  }

  /** Read a complete stable snapshot without granting mutation authority. */
  async inspect(
    path: string,
    options: WorkspaceFileReadOptions = {},
  ): Promise<WorkspaceFileReadResult> {
    const snapshot = await this.readSnapshot(path, options);
    return {
      ...this.createReceipt(snapshot),
      content: snapshot.content,
    };
  }

  /**
   * Return a bounded model-visible window. Mutation authority is granted only
   * after this service has observed every character of the same file version.
   */
  async readWindow(
    path: string,
    options: WorkspaceFileWindowReadOptions = {},
  ): Promise<WorkspaceFileWindowReadResult> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 4_000;
    assertReadWindowNumber("offset", offset, { min: 0 });
    assertReadWindowNumber("limit", limit, { min: 2, max: 4_000 });
    if (offset > 0 && !options.expectedVersion) {
      throw new WorkspaceFileError(
        "INVALID_EXPECTED_VERSION",
        "expected_version is required when continuing a paged ReadFile call.",
      );
    }

    const snapshot = await this.readSnapshot(path, options);
    if (
      options.expectedVersion !== undefined
      && options.expectedVersion !== snapshot.version
    ) {
      throw new WorkspaceFileError(
        "STALE_FILE",
        `File changed between paged reads: ${this.relativePath(snapshot.absolutePath)}. `
        + "Restart from offset 0.",
      );
    }

    const totalCharacters = snapshot.content.length;
    if (offset > totalCharacters || (offset === totalCharacters && totalCharacters > 0)) {
      throw new WorkspaceFileError(
        "INVALID_READ_RANGE",
        `ReadFile offset ${offset} is outside ${this.relativePath(snapshot.absolutePath)} `
        + `(${totalCharacters} UTF-16 units).`,
      );
    }
    if (splitsSurrogatePair(snapshot.content, offset)) {
      throw new WorkspaceFileError(
        "INVALID_READ_RANGE",
        `ReadFile offset ${offset} splits a Unicode surrogate pair in `
        + `${this.relativePath(snapshot.absolutePath)}. Use nextOffset from the previous result.`,
      );
    }

    const endOffset = unicodeSafeEndOffset(snapshot.content, offset, limit);
    const content = snapshot.content.slice(offset, endOffset);
    this.recordObservedWindow(snapshot, offset, endOffset);
    const hasMore = endOffset < totalCharacters;
    return {
      ...this.createReceipt(snapshot),
      content,
      startOffset: offset,
      endOffset,
      totalCharacters,
      hasMore,
      ...(hasMore ? { nextOffset: endOffset } : {}),
    };
  }

  private async readSnapshot(
    path: string,
    options: WorkspaceFileReadOptions,
  ): Promise<StableFileSnapshot> {
    if (
      options.maxBytes !== undefined
      && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
    ) {
      throw new Error("maxBytes must be a non-negative safe integer.");
    }
    const absolutePath = await this.resolveContainedPath(path);
    let pathGuard = await captureWorkspacePathGuard(
      this.workspaceRoot,
      absolutePath,
      path,
    );
    return await withAtomicFileTransaction(
      absolutePath,
      pathGuard.canonicalRoot,
      async (recover) => {
        const recovered = await recover(pathGuard.validate);
        if (recovered) {
          try {
            const recoveredPath = await this.resolveContainedPath(path);
            if (recoveredPath !== absolutePath) {
              throw stalePathError(
                path,
                "File path identity changed while an interrupted replacement was recovered.",
              );
            }
            pathGuard = await captureWorkspacePathGuard(
              this.workspaceRoot,
              absolutePath,
              path,
            );
            await pathGuard.validate();
          } catch (error) {
            throw new Error(
              `Interrupted replacement recovery changed state before path verification failed: ${path}`,
              { cause: error },
            );
          }
        }
        let snapshot: StableFileSnapshot;
        try {
          snapshot = await readStableSnapshot(absolutePath, options.maxBytes);
          await pathGuard.validate();
        } catch (error) {
          if (recovered && error instanceof WorkspaceFileError) {
            throw new Error(
              `Interrupted replacement was recovered, but the resulting file could not be verified: ${path}`,
              { cause: error },
            );
          }
          throw error;
        }
        return snapshot;
      },
    );
  }

  async write(
    path: string,
    content: string,
    options: WorkspaceFileWriteOptions = {},
  ): Promise<WorkspaceFileWriteResult> {
    assertValidUtf8Text(content, path);
    const absolutePath = await this.resolveContainedPath(path);
    return await withFileMutationLock(absolutePath, async () => {
      const parentCreated = await ensureSafeParentDirectory(
        this.workspaceRoot,
        absolutePath,
        path,
      );
      return await classifyWorkspaceErrorsAfterSideEffect(
        parentCreated,
        path,
        async () => {
          const guardedPath = await this.resolveContainedPath(path);
          if (guardedPath !== absolutePath) {
            throw stalePathError(path, "File path identity changed before write preparation.");
          }
          const pathGuard = await captureWorkspacePathGuard(
            this.workspaceRoot,
            absolutePath,
            path,
          );
          const current = await readSnapshotIfPresent(absolutePath);
          this.assertMutationAllowed(absolutePath, current, options.expectedVersion);

          const latest = await readSnapshotIfPresent(absolutePath);
          if (current && latest) {
            assertSameSnapshot(current, latest, path);
          } else if (current || latest) {
            throw new WorkspaceFileError(
              "STALE_FILE",
              `File existence changed while the write was being prepared: ${path}. `
              + "Read it and retry.",
            );
          }

          await pathGuard.validate();
          let committedSnapshot: StableFileSnapshot | undefined;
          try {
            await writeTextFileAtomic(absolutePath, content, {
              mode: current ? current.mode & 0o777 : undefined,
              temporaryDirectory: pathGuard.canonicalRoot,
              commitGuard: createAtomicCommitGuard({
                path,
                pathGuard,
                current,
                expectedContent: content,
                onCommitted: (snapshot) => {
                  committedSnapshot = snapshot;
                },
              }),
            });
          } catch (error) {
            if (
              error instanceof AtomicWriteConflictError
              && error.sideEffects === "none"
            ) {
              throw stalePathError(path, error.message);
            }
            throw error;
          }
          if (!committedSnapshot) {
            throw new Error(`Atomic write committed without a verified receipt snapshot: ${path}`);
          }
          const receipt = this.recordReceipt(committedSnapshot);
          return {
            ...receipt,
            created: current === undefined,
            characterCount: content.length,
          };
        },
      );
    });
  }

  async edit(
    path: string,
    oldString: string,
    newString: string,
    options: WorkspaceFileEditOptions = {},
  ): Promise<WorkspaceFileEditResult> {
    if (!oldString) {
      throw new WorkspaceFileError(
        "INVALID_EDIT",
        "old_string must not be empty.",
      );
    }
    if (oldString === newString) {
      throw new WorkspaceFileError(
        "INVALID_EDIT",
        "old_string and new_string must be different.",
      );
    }

    assertValidUtf8Text(newString, path);
    const absolutePath = await this.resolveContainedPath(path);
    return await withFileMutationLock(absolutePath, async () => {
      const guardedPath = await this.resolveContainedPath(path);
      if (guardedPath !== absolutePath) {
        throw stalePathError(path, "File path identity changed before edit preparation.");
      }
      const current = await readSnapshotIfPresent(absolutePath);
      if (!current) {
        throw new WorkspaceFileError(
          "OLD_STRING_NOT_FOUND",
          `Cannot edit missing file: ${path}`,
        );
      }
      const pathGuard = await captureWorkspacePathGuard(
        this.workspaceRoot,
        absolutePath,
        path,
      );
      this.assertMutationAllowed(absolutePath, current, options.expectedVersion);

      const replacements = countOccurrences(current.content, oldString);
      if (replacements === 0) {
        throw new WorkspaceFileError(
          "OLD_STRING_NOT_FOUND",
          `old_string not found in ${path}`,
        );
      }
      if (!options.replaceAll && replacements > 1) {
        throw new WorkspaceFileError(
          "AMBIGUOUS_EDIT",
          `old_string matches ${replacements} locations in ${path}; `
          + "provide more context or set replace_all=true.",
        );
      }

      const updated = options.replaceAll
        ? current.content.split(oldString).join(newString)
        : replaceFirst(current.content, oldString, newString);

      // Re-read after edit calculation so an external writer cannot silently
      // invalidate the receipt while this operation is preparing the payload.
      const latest = await readStableSnapshot(absolutePath);
      assertSameSnapshot(current, latest, path);

      await pathGuard.validate();
      let committedSnapshot: StableFileSnapshot | undefined;
      try {
        await writeTextFileAtomic(absolutePath, updated, {
          mode: current.mode & 0o777,
          temporaryDirectory: pathGuard.canonicalRoot,
          commitGuard: createAtomicCommitGuard({
            path,
            pathGuard,
            current,
            expectedContent: updated,
            onCommitted: (snapshot) => {
              committedSnapshot = snapshot;
            },
          }),
        });
      } catch (error) {
        if (
          error instanceof AtomicWriteConflictError
          && error.sideEffects === "none"
        ) {
          throw stalePathError(path, error.message);
        }
        throw error;
      }
      if (!committedSnapshot) {
        throw new Error(`Atomic edit committed without a verified receipt snapshot: ${path}`);
      }
      const receipt = this.recordReceipt(committedSnapshot);
      return {
        ...receipt,
        created: false,
        characterCount: updated.length,
        replacements: options.replaceAll ? replacements : 1,
      };
    });
  }

  clear(): void {
    this.receipts.clear();
    this.receiptSnapshots.clear();
    this.observedCoverage.clear();
  }

  private async resolveContainedPath(path: string): Promise<string> {
    return await resolveContainedWorkspacePath(this.workspaceRoot, path);
  }

  private assertMutationAllowed(
    absolutePath: string,
    current: StableFileSnapshot | undefined,
    expectedVersion: string | undefined,
  ): void {
    if (!current) {
      if (expectedVersion !== undefined) {
        throw new WorkspaceFileError(
          "INVALID_EXPECTED_VERSION",
          `File does not exist, but expected_version was provided: `
          + `${this.relativePath(absolutePath)}`,
        );
      }
      return;
    }

    const receipt = this.receipts.get(absolutePath);
    const receiptSnapshot = this.receiptSnapshots.get(absolutePath);
    if (!receipt || !receiptSnapshot) {
      throw new WorkspaceFileError(
        "READ_REQUIRED",
        `Read ${this.relativePath(absolutePath)} in this session before overwriting or editing it.`,
      );
    }
    if (expectedVersion !== undefined && expectedVersion !== receipt.version) {
      throw new WorkspaceFileError(
        "INVALID_EXPECTED_VERSION",
        `expected_version does not match this session's read receipt for `
        + `${this.relativePath(absolutePath)}.`,
      );
    }
    assertSameSnapshot(
      receiptSnapshot,
      current,
      this.relativePath(absolutePath),
      "File changed after it was read",
    );
  }

  private recordReceipt(snapshot: StableFileSnapshot): WorkspaceFileReceipt {
    const receipt = this.createReceipt(snapshot);
    this.receipts.set(snapshot.absolutePath, receipt);
    this.receiptSnapshots.set(snapshot.absolutePath, structuredClone(snapshot));
    return receipt;
  }

  private createReceipt(snapshot: StableFileSnapshot): WorkspaceFileReceipt {
    return {
      path: this.relativePath(snapshot.absolutePath),
      version: snapshot.version,
      mtimeMs: snapshot.mtimeMs,
      size: snapshot.size,
      encoding: "utf8" as const,
      newline: detectNewlineStyle(snapshot.content),
    };
  }

  private recordObservedWindow(
    snapshot: StableFileSnapshot,
    start: number,
    end: number,
  ): void {
    const existing = this.observedCoverage.get(snapshot.absolutePath);
    const coverage = existing?.version === snapshot.version
      ? existing
      : { version: snapshot.version, ranges: [] };
    if (existing?.version !== snapshot.version) {
      this.receipts.delete(snapshot.absolutePath);
      this.receiptSnapshots.delete(snapshot.absolutePath);
    }
    coverage.ranges = mergeCoverageRanges([...coverage.ranges, { start, end }]);
    this.observedCoverage.set(snapshot.absolutePath, coverage);
    if (
      coverage.ranges.length === 1
      && coverage.ranges[0]!.start === 0
      && coverage.ranges[0]!.end === snapshot.content.length
    ) {
      this.recordReceipt(snapshot);
    }
  }

  private relativePath(absolutePath: string): string {
    return relative(this.workspaceRoot, absolutePath).replace(/\\/g, "/") || ".";
  }

}

export async function globWorkspaceFiles(workspaceRoot: string, pattern: string): Promise<string[]> {
  if (isOutside(workspaceRoot, patternPrefix(pattern))) {
    throw new WorkspaceFileError(
      "OUTSIDE_WORKSPACE",
      `Path is outside the workspace sandbox: ${pattern}`,
    );
  }

  const matcher = globToRegExp(pattern.replace(/\\/g, "/"));
  const results: string[] = [];
  const resolvedRoot = resolve(workspaceRoot);
  const rootStats = await lstat(resolvedRoot);
  assertSafeDirectory(rootStats, resolvedRoot, pattern);
  const canonicalRoot = await realpath(resolvedRoot);
  if (!samePath(canonicalRoot, resolvedRoot)) {
    throw new WorkspaceFileError(
      "UNSAFE_FILE_TYPE",
      `Symbolic-link or junction workspace roots are not supported: ${workspaceRoot}`,
    );
  }

  async function walk(
    relativeDir: string,
    expectedIdentity?: AtomicFileIdentity,
  ): Promise<void> {
    const absoluteDir = resolve(canonicalRoot, relativeDir || ".");
    assertContained(canonicalRoot, absoluteDir, pattern);
    const directoryIdentity = await validateGlobDirectory(
      canonicalRoot,
      absoluteDir,
      pattern,
      expectedIdentity,
    );
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    await validateGlobDirectory(canonicalRoot, absoluteDir, pattern, directoryIdentity);
    for (const entry of entries) {
      await validateGlobDirectory(canonicalRoot, absoluteDir, pattern, directoryIdentity);
      if (isAtomicInternalEntry(entry.name)) continue;
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolutePath = resolve(canonicalRoot, relativePath);
      assertContained(canonicalRoot, absolutePath, pattern);
      let stats: Stats;
      try {
        stats = await lstat(absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (stats.isSymbolicLink()) continue;
      const canonicalPath = await realpath(absolutePath);
      assertContained(canonicalRoot, canonicalPath, pattern);
      if (!samePath(canonicalPath, absolutePath)) {
        throw new WorkspaceFileError(
          "UNSAFE_FILE_TYPE",
          `Symbolic-link or junction path appeared during glob: ${relativePath}`,
        );
      }
      if (stats.isDirectory()) {
        await walk(relativePath, { dev: stats.dev, ino: stats.ino });
        continue;
      }
      if (!stats.isFile()) continue;
      const verified = await lstat(absolutePath);
      if (
        verified.isSymbolicLink()
        || !verified.isFile()
        || !sameFileIdentity(stats, verified)
      ) {
        throw stalePathError(
          relativePath,
          "File identity changed while glob results were collected.",
        );
      }
      const normalized = relativePath.replace(/\\/g, "/");
      if (matcher.test(normalized)) {
        results.push(normalized);
      }
    }
    await validateGlobDirectory(canonicalRoot, absoluteDir, pattern, directoryIdentity);
  }

  await walk("");
  return results.sort((left, right) => left.localeCompare(right));
}

function isAtomicInternalEntry(name: string): boolean {
  return name.includes(".atomic-old.")
    || name.includes(".atomic-replace.json")
    || /^\..+\.\d+\.[a-f0-9-]+\.tmp$/i.test(name);
}

async function resolveContainedWorkspacePath(
  workspaceRoot: string,
  path: string,
): Promise<string> {
  if (!path.trim()) {
    throw new WorkspaceFileError("OUTSIDE_WORKSPACE", "File path is required.");
  }

  const resolvedRoot = resolve(workspaceRoot);
  const rootStats = await lstat(resolvedRoot);
  assertSafeDirectory(rootStats, resolvedRoot, path);
  const candidate = isAbsolute(path)
    ? resolve(path)
    : resolve(resolvedRoot, path);
  assertContained(resolvedRoot, candidate, path);

  const canonicalRoot = await realpath(resolvedRoot);
  if (!samePath(canonicalRoot, resolvedRoot)) {
    throw new WorkspaceFileError(
      "UNSAFE_FILE_TYPE",
      `Symbolic-link or junction workspace roots are not supported: ${workspaceRoot}`,
    );
  }
  let cursor = candidate;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const canonicalAncestor = await realpath(cursor);
      assertContained(canonicalRoot, canonicalAncestor, path);
      const canonicalPath = resolve(canonicalAncestor, ...missingSegments);
      assertContained(canonicalRoot, canonicalPath, path);
      await assertNoSymbolicLinkComponents(resolvedRoot, candidate, path);
      return canonicalPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (cursor === resolvedRoot) throw error;
      missingSegments.unshift(basename(cursor));
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new WorkspaceFileError(
          "OUTSIDE_WORKSPACE",
          `Path is outside the workspace sandbox: ${path}`,
        );
      }
      cursor = parent;
    }
  }
}

async function validateGlobDirectory(
  canonicalRoot: string,
  directoryPath: string,
  originalPattern: string,
  expectedIdentity?: AtomicFileIdentity,
): Promise<AtomicFileIdentity> {
  const stats = await lstat(directoryPath);
  assertSafeDirectory(stats, directoryPath, originalPattern);
  if (expectedIdentity && !sameFileIdentity(expectedIdentity, stats)) {
    throw stalePathError(
      originalPattern,
      `Directory identity changed while glob was traversing: ${directoryPath}.`,
    );
  }
  const canonicalPath = await realpath(directoryPath);
  assertContained(canonicalRoot, canonicalPath, originalPattern);
  if (!samePath(canonicalPath, directoryPath)) {
    throw new WorkspaceFileError(
      "UNSAFE_FILE_TYPE",
      `Symbolic-link or junction directory appeared during glob: ${directoryPath}`,
    );
  }
  return { dev: stats.dev, ino: stats.ino };
}

async function readSnapshotIfPresent(
  absolutePath: string,
): Promise<StableFileSnapshot | undefined> {
  try {
    return await readStableSnapshot(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function workspacePathEntryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function withFileMutationLock<T>(
  absolutePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = FILE_MUTATION_LOCKS.get(absolutePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  const tail = previous.then(
    () => current,
    () => current,
  );
  FILE_MUTATION_LOCKS.set(absolutePath, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (FILE_MUTATION_LOCKS.get(absolutePath) === tail) {
      FILE_MUTATION_LOCKS.delete(absolutePath);
    }
  }
}

async function readStableSnapshot(
  absolutePath: string,
  maxBytes?: number,
): Promise<StableFileSnapshot> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lexicalStats = await lstat(absolutePath);
    assertRegularFile(lexicalStats, absolutePath);
    assertFileSizeWithinLimit(lexicalStats.size, maxBytes, absolutePath);

    let handle;
    try {
      handle = await open(
        absolutePath,
        constants.O_RDONLY
        | (
          process.platform === "win32"
            ? 0
            : constants.O_NONBLOCK | constants.O_NOFOLLOW
        ),
      );
      const before = await handle.stat();
      assertRegularFile(before, absolutePath);
      assertFileSizeWithinLimit(before.size, maxBytes, absolutePath);
      const bytes = await handle.readFile();
      const after = await handle.stat();
      const pathAfter = await lstat(absolutePath);
      assertRegularFile(pathAfter, absolutePath);
      if (
        sameFileIdentity(lexicalStats, before)
        && sameFileIdentity(before, after)
        && sameFileIdentity(after, pathAfter)
        && before.mtimeMs === after.mtimeMs
        && before.ctimeMs === after.ctimeMs
        && before.size === after.size
      ) {
        const content = decodeUtf8(bytes, absolutePath);
        return {
          absolutePath,
          content,
          version: contentVersion(content),
          mtimeMs: after.mtimeMs,
          ctimeMs: after.ctimeMs,
          size: after.size,
          mode: after.mode,
          dev: after.dev,
          ino: after.ino,
        };
      }
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
  throw new WorkspaceFileError(
    "STALE_FILE",
    `File changed while it was being read: ${absolutePath}`,
  );
}

function assertFileSizeWithinLimit(
  size: number,
  maxBytes: number | undefined,
  path: string,
): void {
  if (maxBytes === undefined || size <= maxBytes) return;
  throw new WorkspaceFileError(
    "FILE_TOO_LARGE",
    `File exceeds the ${maxBytes}-byte read limit (${size} bytes): ${path}`,
  );
}

function assertReadWindowNumber(
  name: "offset" | "limit",
  value: number,
  bounds: { min: number; max?: number },
): void {
  if (
    !Number.isSafeInteger(value)
    || value < bounds.min
    || (bounds.max !== undefined && value > bounds.max)
  ) {
    const range = bounds.max === undefined
      ? `at least ${bounds.min}`
      : `between ${bounds.min} and ${bounds.max}`;
    throw new WorkspaceFileError(
      "INVALID_READ_RANGE",
      `ReadFile ${name} must be a safe integer ${range}.`,
    );
  }
}

function splitsSurrogatePair(content: string, offset: number): boolean {
  if (offset <= 0 || offset >= content.length) return false;
  const previous = content.charCodeAt(offset - 1);
  const current = content.charCodeAt(offset);
  return previous >= 0xD800 && previous <= 0xDBFF
    && current >= 0xDC00 && current <= 0xDFFF;
}

function unicodeSafeEndOffset(content: string, offset: number, limit: number): number {
  let end = Math.min(content.length, offset + limit);
  if (!splitsSurrogatePair(content, end)) return end;
  if (end === offset + 1) {
    end += 1;
  } else {
    end -= 1;
  }
  return end;
}

function mergeCoverageRanges(
  ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const sorted = ranges
    .filter((range) => range.end >= range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function assertSameSnapshot(
  expected: StableFileSnapshot,
  actual: StableFileSnapshot,
  path: string,
  action = "File changed while the edit was being prepared",
): void {
  if (
    expected.version !== actual.version
    || expected.mtimeMs !== actual.mtimeMs
    || expected.ctimeMs !== actual.ctimeMs
    || expected.size !== actual.size
    || expected.dev !== actual.dev
    || expected.ino !== actual.ino
  ) {
    throw new WorkspaceFileError(
      "STALE_FILE",
      `${action}: ${path}. Read it again and retry.`,
    );
  }
}

function createAtomicCommitGuard(input: {
  path: string;
  pathGuard: WorkspacePathGuard;
  current: StableFileSnapshot | undefined;
  expectedContent: string;
  onCommitted: (snapshot: StableFileSnapshot) => void;
}): AtomicCommitGuard {
  return {
    expectedTargetExists: input.current !== undefined,
    validatePath: input.pathGuard.validate,
    async validateDisplaced(displacedPath) {
      if (!input.current) {
        if (displacedPath) {
          throw stalePathError(
            input.path,
            "A destination appeared while a new file was being committed.",
          );
        }
        return;
      }
      if (!displacedPath) {
        throw stalePathError(
          input.path,
          "The destination disappeared while the write was being committed.",
        );
      }
      const displaced = await readStableSnapshot(displacedPath);
      assertSameDisplacedSnapshot(
        input.current,
        displaced,
        input.path,
      );
    },
    async validateCommitted(committedPath) {
      await input.pathGuard.validate();
      const committed = await readStableSnapshot(committedPath);
      assertWrittenContent(committed, input.expectedContent, input.path);
      input.onCommitted(committed);
    },
  };
}

function assertSameDisplacedSnapshot(
  expected: StableFileSnapshot,
  actual: StableFileSnapshot,
  path: string,
): void {
  // Moving the inode to the transaction directory may legitimately update
  // ctime on Windows. Identity, content, mtime, size, and mode remain bound to
  // the caller's snapshot and still detect an external replacement or write.
  if (
    expected.version !== actual.version
    || expected.mtimeMs !== actual.mtimeMs
    || expected.size !== actual.size
    || expected.mode !== actual.mode
    || expected.dev !== actual.dev
    || expected.ino !== actual.ino
  ) {
    throw new WorkspaceFileError(
      "STALE_FILE",
      `File changed at the atomic commit boundary: ${path}. Read it again and retry.`,
    );
  }
}

async function ensureSafeParentDirectory(
  workspaceRoot: string,
  absolutePath: string,
  originalPath: string,
): Promise<boolean> {
  const parentPath = dirname(absolutePath);
  const existedBefore = await workspacePathEntryExists(parentPath);
  await mkdir(parentPath, { recursive: true });
  try {
    const canonicalRoot = await realpath(resolve(workspaceRoot));
    const canonicalParent = await realpath(parentPath);
    assertContained(canonicalRoot, canonicalParent, originalPath);
    if (!samePath(canonicalParent, parentPath)) {
      throw new WorkspaceFileError(
        "UNSAFE_FILE_TYPE",
        `Symbolic-link or junction parent is not allowed for workspace writes: ${originalPath}`,
      );
    }
  } catch (error) {
    if (!existedBefore && error instanceof WorkspaceFileError) {
      throw new Error(
        `Parent directory creation may have changed the workspace before verification failed: `
        + originalPath,
        { cause: error },
      );
    }
    throw error;
  }
  return !existedBefore;
}

async function classifyWorkspaceErrorsAfterSideEffect<T>(
  sideEffectOccurred: boolean,
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (sideEffectOccurred && error instanceof WorkspaceFileError) {
      throw new Error(
        `Workspace directories were created before the file operation was rejected: ${path}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function captureWorkspacePathGuard(
  workspaceRoot: string,
  absolutePath: string,
  originalPath: string,
): Promise<WorkspacePathGuard> {
  const canonicalRoot = await realpath(resolve(workspaceRoot));
  const parentPath = dirname(absolutePath);
  assertContained(canonicalRoot, parentPath, originalPath);
  const pathFromRoot = relative(canonicalRoot, parentPath);
  const segments = pathFromRoot && pathFromRoot !== "."
    ? pathFromRoot.split(/[\\/]+/).filter(Boolean)
    : [];
  const paths = [canonicalRoot];
  let cursor = canonicalRoot;
  for (const segment of segments) {
    cursor = resolve(cursor, segment);
    paths.push(cursor);
  }

  const directories: GuardedDirectoryIdentity[] = [];
  for (const directoryPath of paths) {
    const stats = await lstat(directoryPath);
    assertSafeDirectory(stats, directoryPath, originalPath);
    directories.push({
      path: directoryPath,
      dev: stats.dev,
      ino: stats.ino,
    });
  }

  return {
    canonicalRoot,
    directories,
    async validate() {
      for (const expected of directories) {
        const stats = await lstat(expected.path);
        assertSafeDirectory(stats, expected.path, originalPath);
        if (stats.dev !== expected.dev || stats.ino !== expected.ino) {
          throw stalePathError(
            originalPath,
            `Workspace directory identity changed during commit: ${expected.path}`,
          );
        }
        const canonical = await realpath(expected.path);
        assertContained(canonicalRoot, canonical, originalPath);
        if (!samePath(canonical, expected.path)) {
          throw new WorkspaceFileError(
            "UNSAFE_FILE_TYPE",
            `Symbolic-link or junction directory is not allowed during commit: ${originalPath}`,
          );
        }
      }
    },
  };
}

async function assertNoSymbolicLinkComponents(
  workspaceRoot: string,
  candidate: string,
  originalPath: string,
): Promise<void> {
  const pathFromRoot = relative(resolve(workspaceRoot), candidate);
  if (!pathFromRoot || pathFromRoot === ".") return;
  let cursor = resolve(workspaceRoot);
  const segments = pathFromRoot.split(/[\\/]+/).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    cursor = resolve(cursor, segments[index]!);
    let stats: Stats;
    try {
      stats = await lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new WorkspaceFileError(
        "UNSAFE_FILE_TYPE",
        `Symbolic links and junctions are not allowed in workspace file paths: ${originalPath}`,
      );
    }
    const isLast = index === segments.length - 1;
    if (!isLast && !stats.isDirectory()) {
      throw new WorkspaceFileError(
        "UNSAFE_FILE_TYPE",
        `Non-directory path component is not allowed: ${originalPath}`,
      );
    }
    if (isLast && !stats.isDirectory() && !stats.isFile()) {
      throw new WorkspaceFileError(
        "UNSAFE_FILE_TYPE",
        `Special files are not supported: ${originalPath}`,
      );
    }
  }
}

function assertSafeDirectory(
  stats: Stats,
  absolutePath: string,
  originalPath: string,
): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new WorkspaceFileError(
      "UNSAFE_FILE_TYPE",
      `Unsafe workspace directory for ${originalPath}: ${absolutePath}`,
    );
  }
}

function assertRegularFile(stats: Stats, absolutePath: string): void {
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new WorkspaceFileError(
      "UNSAFE_FILE_TYPE",
      `Only regular text files are supported: ${absolutePath}`,
    );
  }
}

function sameFileIdentity(
  left: { dev: number; ino: number },
  right: { dev: number; ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new WorkspaceFileError(
      "INVALID_UTF8",
      `File is not valid UTF-8 text: ${path}. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertValidUtf8Text(content: string, path: string): void {
  if (Buffer.from(content, "utf8").toString("utf8") !== content) {
    throw new WorkspaceFileError(
      "INVALID_UTF8",
      `Content contains an invalid Unicode surrogate and cannot be written as UTF-8: ${path}`,
    );
  }
}

function assertWrittenContent(
  snapshot: StableFileSnapshot,
  expectedContent: string,
  path: string,
): void {
  if (snapshot.content !== expectedContent) {
    throw stalePathError(
      path,
      "File changed before the committed content could be verified.",
    );
  }
}

function stalePathError(path: string, detail: string): WorkspaceFileError {
  return new WorkspaceFileError(
    "STALE_FILE",
    `${detail} ${path}. Read it again and retry.`,
  );
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function contentVersion(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function detectNewlineStyle(content: string): WorkspaceFileReceipt["newline"] {
  const crlfCount = content.match(/\r\n/g)?.length ?? 0;
  const lfCount = (content.match(/\n/g)?.length ?? 0) - crlfCount;
  if (crlfCount > 0 && lfCount > 0) return "mixed";
  if (crlfCount > 0) return "crlf";
  if (lfCount > 0) return "lf";
  return "none";
}

export function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= content.length - needle.length) {
    const index = content.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function replaceFirst(content: string, oldString: string, newString: string): string {
  const index = content.indexOf(oldString);
  return `${content.slice(0, index)}${newString}${content.slice(index + oldString.length)}`;
}

function assertContained(root: string, target: string, originalPath: string): void {
  if (isOutside(root, target)) {
    throw new WorkspaceFileError(
      "OUTSIDE_WORKSPACE",
      `Path is outside the workspace sandbox: ${originalPath}`,
    );
  }
}

function isOutside(root: string, target: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(root, target));
  return pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot);
}

function patternPrefix(pattern: string): string {
  const normalized = pattern.replace(/\\/g, "/");
  const wildcard = normalized.search(/[*?[\]{}]/);
  return wildcard < 0 ? normalized : normalized.slice(0, wildcard);
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    if (char === "*" && normalized[index + 1] === "*") {
      index += 1;
      if (normalized[index + 1] === "/") {
        index += 1;
        // `**/` spans zero or more directories, so **/*.md also matches
        // workspace-root files instead of requiring at least one slash.
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`${source}$`);
}
