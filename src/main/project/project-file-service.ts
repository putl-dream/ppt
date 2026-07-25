import { randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ProjectArtifact, ProjectArtifactStatus, SessionSnapshot } from "@shared/session";
import { createArtifactDiff, type ArtifactDiff } from "./artifact-diff";
import {
  findArtifactByProjectPath,
  markDownstreamArtifactsStale,
} from "./artifact-graph";
import {
  createDeckSnapshotContent,
  createDefaultProjectFiles,
  createProjectSandbox,
} from "./project-schema";
import {
  globWorkspaceFiles,
  WorkspaceFileService,
  type WorkspaceFileReadResult,
  type WorkspaceFileReceipt,
} from "../agent/tools/files/workspace-file-service";

const MAX_PROJECT_FILE_ENTRIES = 2_000;
const MAX_EDITOR_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EDITOR_SESSIONS = 128;
const EDITOR_SESSION_TTL_MS = 30 * 60 * 1_000;

export interface ProjectArtifactReadResult {
  path: string;
  type: "file" | "directory";
  content?: string;
  entries?: string[];
  version?: string;
  mtimeMs?: number;
  size?: number;
  encoding?: "utf8";
  newline?: "lf" | "crlf" | "mixed" | "none";
}

export interface ProjectArtifactWriteOptions {
  overwrite?: boolean;
  markStale?: boolean;
}

export interface ProjectArtifactWriteResult {
  path: string;
  changed: boolean;
  changedArtifactId?: string;
  staleArtifactIds: string[];
}

export interface ProjectFileEditorReadResult extends WorkspaceFileReceipt {
  content: string;
  editToken: string;
  editable: boolean;
  readOnlyReason?: string;
}

export interface ProjectFileEditorWriteResult
  extends WorkspaceFileReceipt, ProjectArtifactWriteResult {
  characterCount: number;
  editToken: string;
  postCommitWarnings?: Array<
    "session-state-persistence-failed"
    | "workspace-metadata-sync-failed"
  >;
}

interface ProjectFileEditorSession {
  sessionId: string;
  projectRootPath: string;
  path: string;
  service: WorkspaceFileService;
  touchedAt: number;
}

/**
 * Owns the stable project artifact filesystem.
 *
 * All text reads and writes reuse WorkspaceFileService, so Renderer, Agent and
 * persistence paths share the same UTF-8, symlink, atomic-replace and
 * cross-process locking boundary. Interactive editors receive an isolated
 * read scope: another caller cannot refresh its receipt and accidentally mask
 * an inode/content conflict.
 */
export class ProjectFileService {
  private readonly editorSessions = new Map<string, ProjectFileEditorSession>();

  constructor(private readonly projectRootPath: string) {}

  /**
   * 为会话创建或补齐本地项目沙箱与默认产物文件。
   * 返回值表示项目元数据是否变化，调用方据此决定是否持久化 SessionSnapshot。
   */
  async ensureProjectSandbox(snapshot: SessionSnapshot): Promise<boolean> {
    const project = createProjectSandbox(snapshot, this.projectRootPath);
    const changed = JSON.stringify(snapshot.project) !== JSON.stringify(project);
    snapshot.project = project;

    await mkdir(project.rootPath, { recursive: true });
    for (const template of createDefaultProjectFiles(snapshot)) {
      await this.writeArtifact(snapshot, template.path, template.content, {
        overwrite: false,
        markStale: false,
      });
    }

    return changed;
  }

  listArtifacts(snapshot: SessionSnapshot): ProjectArtifact[] {
    return structuredClone(this.requireProject(snapshot).artifacts);
  }

  async listProjectFiles(snapshot: SessionSnapshot): Promise<string[]> {
    const files = await globWorkspaceFiles(
      this.requireProject(snapshot).rootPath,
      "**/*",
    );
    if (files.length > MAX_PROJECT_FILE_ENTRIES) {
      throw new Error(
        `Project contains ${files.length} files; the file manager limit is `
        + `${MAX_PROJECT_FILE_ENTRIES}. Narrow the project before opening it.`,
      );
    }
    return files;
  }

  async readArtifact(
    snapshot: SessionSnapshot,
    artifactIdOrPath: string,
  ): Promise<ProjectArtifactReadResult> {
    const relativePath = this.resolveArtifactPath(snapshot, artifactIdOrPath);
    const filePath = this.resolveProjectPath(snapshot, relativePath);
    const fileStat = await lstat(filePath);

    if (fileStat.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported in project artifacts: ${relativePath}`);
    }
    if (fileStat.isDirectory()) {
      return {
        path: relativePath,
        type: "directory",
        entries: await this.listDirectoryFiles(snapshot, relativePath),
      };
    }

    const result = await this.createWorkspaceFileService(snapshot).read(relativePath);
    return {
      ...result,
      type: "file",
    };
  }

  async openProjectFile(
    snapshot: SessionSnapshot,
    relativePath: string,
  ): Promise<ProjectFileEditorReadResult> {
    this.pruneEditorSessions();
    this.resolveProjectPath(snapshot, relativePath);
    const service = this.createWorkspaceFileService(snapshot);
    let result: WorkspaceFileReadResult;
    try {
      result = await service.read(relativePath, {
        maxBytes: MAX_EDITOR_FILE_BYTES,
      });
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "FILE_TOO_LARGE"
      ) {
        throw new Error(
          `Project file is too large for the editor (limit `
          + `${MAX_EDITOR_FILE_BYTES} bytes): ${relativePath}`,
          { cause: error },
        );
      }
      throw error;
    }
    if (result.size > MAX_EDITOR_FILE_BYTES) {
      throw new Error(
        `Project file is too large for the editor (${result.size} bytes; `
        + `limit ${MAX_EDITOR_FILE_BYTES}): ${result.path}`,
      );
    }

    while (this.editorSessions.size >= MAX_EDITOR_SESSIONS) {
      const oldestToken = this.editorSessions.keys().next().value as string | undefined;
      if (!oldestToken) break;
      this.editorSessions.delete(oldestToken);
    }

    const editToken = randomUUID();
    const editPolicy = this.getEditPolicy(snapshot, result.path);
    this.editorSessions.set(editToken, {
      sessionId: snapshot.session.id,
      projectRootPath: resolve(this.requireProject(snapshot).rootPath),
      path: result.path,
      service,
      touchedAt: Date.now(),
    });
    return {
      ...result,
      editToken,
      ...editPolicy,
    };
  }

  async saveProjectFile(
    snapshot: SessionSnapshot,
    relativePath: string,
    content: string,
    editToken: string,
    expectedVersion: string,
  ): Promise<ProjectFileEditorWriteResult> {
    this.pruneEditorSessions();
    const editorSession = this.editorSessions.get(editToken);
    const normalizedPath = normalizeProjectPath(relativePath);
    const currentRoot = resolve(this.requireProject(snapshot).rootPath);
    if (
      !editorSession
      || editorSession.sessionId !== snapshot.session.id
      || editorSession.projectRootPath !== currentRoot
      || editorSession.path !== normalizedPath
    ) {
      throw new Error("Project file edit session is missing, expired, or does not match this file.");
    }
    const editPolicy = this.getEditPolicy(snapshot, editorSession.path);
    if (!editPolicy.editable) {
      throw new Error(editPolicy.readOnlyReason ?? "This project file is read-only.");
    }
    if (Buffer.byteLength(content, "utf8") > MAX_EDITOR_FILE_BYTES) {
      throw new Error(
        `Project file content exceeds the editor limit of ${MAX_EDITOR_FILE_BYTES} bytes.`,
      );
    }

    try {
      const result = await editorSession.service.write(
        editorSession.path,
        content,
        { expectedVersion },
      );
      editorSession.touchedAt = Date.now();
      const artifactChange = this.recordArtifactChange(
        snapshot,
        result.path,
        true,
      );
      return {
        ...result,
        ...artifactChange,
        changed: true,
        editToken,
      };
    } catch (error) {
      this.editorSessions.delete(editToken);
      throw error;
    }
  }

  /**
   * Compatibility boundary for Renderer workflows that still submit a whole
   * artifact payload. Existing files are opened and committed through the
   * same isolated receipt flow as the file manager; new files are allowed
   * only beneath a registered editable artifact.
   */
  async writeEditableArtifact(
    snapshot: SessionSnapshot,
    relativePath: string,
    content: string,
  ): Promise<ProjectArtifactWriteResult> {
    const normalizedPath = normalizeProjectPath(relativePath);
    this.resolveProjectPath(snapshot, normalizedPath);
    const editPolicy = this.getEditPolicy(snapshot, normalizedPath);
    if (!editPolicy.editable) {
      throw new Error(editPolicy.readOnlyReason ?? "This project file is read-only.");
    }

    let opened: ProjectFileEditorReadResult;
    try {
      opened = await this.openProjectFile(snapshot, normalizedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return await this.writeArtifact(snapshot, normalizedPath, content);
    }

    try {
      if (opened.content === content) {
        return {
          path: opened.path,
          changed: false,
          staleArtifactIds: [],
        };
      }
      const saved = await this.saveProjectFile(
        snapshot,
        opened.path,
        content,
        opened.editToken,
        opened.version,
      );
      return {
        path: saved.path,
        changed: saved.changed,
        changedArtifactId: saved.changedArtifactId,
        staleArtifactIds: saved.staleArtifactIds,
      };
    } finally {
      this.editorSessions.delete(opened.editToken);
    }
  }

  async writeArtifact(
    snapshot: SessionSnapshot,
    relativePath: string,
    content: string,
    options: ProjectArtifactWriteOptions = {},
  ): Promise<ProjectArtifactWriteResult> {
    const overwrite = options.overwrite ?? true;
    const markStale = options.markStale ?? true;
    this.resolveProjectPath(snapshot, relativePath);
    const service = this.createWorkspaceFileService(snapshot);
    const before = await readWorkspaceFileIfPresent(service, relativePath);

    if (!overwrite && before) {
      return {
        path: before.path,
        changed: false,
        staleArtifactIds: [],
      };
    }
    if (before?.content === content) {
      return {
        path: before.path,
        changed: false,
        staleArtifactIds: [],
      };
    }

    const result = await service.write(
      relativePath,
      content,
      { expectedVersion: before?.version },
    );
    return {
      path: result.path,
      changed: true,
      ...this.recordArtifactChange(snapshot, result.path, markStale),
    };
  }

  /** 将 Presentation 写入固定的 deck/snapshot.json，并复用统一的产物状态更新规则。 */
  async writeDeckSnapshot(
    snapshot: SessionSnapshot,
    options: ProjectArtifactWriteOptions = {},
  ): Promise<ProjectArtifactWriteResult> {
    return this.writeArtifact(
      snapshot,
      "deck/snapshot.json",
      createDeckSnapshotContent(snapshot.presentation),
      { markStale: false, ...options },
    );
  }

  async getArtifactDiff(
    snapshot: SessionSnapshot,
    relativePath: string,
    nextContent: string,
  ): Promise<ArtifactDiff> {
    const before = await readWorkspaceFileIfPresent(
      this.createWorkspaceFileService(snapshot),
      relativePath,
    );
    return createArtifactDiff(relativePath, before?.content ?? "", nextContent);
  }

  markArtifactStatus(
    snapshot: SessionSnapshot,
    artifactId: string,
    status: ProjectArtifactStatus,
  ): ProjectArtifact {
    const artifact = this.requireProject(snapshot).artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new Error(`Project artifact not found: ${artifactId}`);
    artifact.status = status;
    return structuredClone(artifact);
  }

  private recordArtifactChange(
    snapshot: SessionSnapshot,
    relativePath: string,
    markStale: boolean,
  ): Pick<ProjectArtifactWriteResult, "changedArtifactId" | "staleArtifactIds"> {
    const changedArtifact = findArtifactByProjectPath(
      this.requireProject(snapshot).artifacts,
      relativePath,
    );
    const staleArtifactIds =
      markStale && changedArtifact
        ? markDownstreamArtifactsStale(
            this.requireProject(snapshot).artifacts,
            changedArtifact.id,
          )
        : [];
    return {
      changedArtifactId: changedArtifact?.id,
      staleArtifactIds,
    };
  }

  private getEditPolicy(
    snapshot: SessionSnapshot,
    relativePath: string,
  ): Pick<ProjectFileEditorReadResult, "editable" | "readOnlyReason"> {
    const artifact = findArtifactByProjectPath(
      this.requireProject(snapshot).artifacts,
      relativePath,
    );
    if (!artifact) {
      return {
        editable: false,
        readOnlyReason: "该文件不属于已注册的项目产物，只能预览。",
      };
    }
    if (artifact.kind === "deck" || artifact.kind === "history") {
      return {
        editable: false,
        readOnlyReason:
          artifact.kind === "deck"
            ? "Deck 文件由 Presentation 与导出服务维护，只能预览。"
            : "History 文件由版本与导出记录服务维护，只能预览。",
      };
    }
    return { editable: true };
  }

  private resolveArtifactPath(snapshot: SessionSnapshot, artifactIdOrPath: string): string {
    const artifact = this.requireProject(snapshot).artifacts.find(
      (item) => item.id === artifactIdOrPath,
    );
    return artifact?.path ?? artifactIdOrPath;
  }

  private async listDirectoryFiles(
    snapshot: SessionSnapshot,
    relativePath: string,
  ): Promise<string[]> {
    const normalizedDirectory = normalizeProjectPath(relativePath);
    const prefix = normalizedDirectory ? `${normalizedDirectory}/` : "";
    return (await this.listProjectFiles(snapshot))
      .filter((path) => path.startsWith(prefix));
  }

  private resolveProjectPath(snapshot: SessionSnapshot, relativePath: string): string {
    const project = this.requireProject(snapshot);
    const rootPath = resolve(project.rootPath);
    const filePath = resolve(rootPath, relativePath);
    const pathFromRoot = relative(rootPath, filePath);

    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
      throw new Error(`Project path is outside the sandbox: ${relativePath}`);
    }
    return filePath;
  }

  private createWorkspaceFileService(snapshot: SessionSnapshot): WorkspaceFileService {
    return new WorkspaceFileService(this.requireProject(snapshot).rootPath);
  }

  private pruneEditorSessions(now = Date.now()): void {
    for (const [token, editorSession] of this.editorSessions) {
      if (now - editorSession.touchedAt > EDITOR_SESSION_TTL_MS) {
        this.editorSessions.delete(token);
      }
    }
  }

  private requireProject(snapshot: SessionSnapshot) {
    if (!snapshot.project) throw new Error("Project sandbox has not been initialized.");
    return snapshot.project;
  }
}

async function readWorkspaceFileIfPresent(
  service: WorkspaceFileService,
  path: string,
) {
  try {
    return await service.read(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}
