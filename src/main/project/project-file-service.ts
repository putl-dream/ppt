import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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

export interface ProjectArtifactReadResult {
  path: string;
  type: "file" | "directory";
  content?: string;
  entries?: string[];
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

export class ProjectFileService {
  constructor(private readonly projectRootPath: string) {}

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

  async readArtifact(
    snapshot: SessionSnapshot,
    artifactIdOrPath: string,
  ): Promise<ProjectArtifactReadResult> {
    const relativePath = this.resolveArtifactPath(snapshot, artifactIdOrPath);
    const filePath = this.resolveProjectPath(snapshot, relativePath);
    const fileStat = await stat(filePath);

    if (fileStat.isDirectory()) {
      return {
        path: relativePath,
        type: "directory",
        entries: await this.listDirectoryFiles(snapshot, relativePath),
      };
    }

    return {
      path: relativePath,
      type: "file",
      content: await readFile(filePath, "utf8"),
    };
  }

  async writeArtifact(
    snapshot: SessionSnapshot,
    relativePath: string,
    content: string,
    options: ProjectArtifactWriteOptions = {},
  ): Promise<ProjectArtifactWriteResult> {
    const overwrite = options.overwrite ?? true;
    const markStale = options.markStale ?? true;
    const filePath = this.resolveProjectPath(snapshot, relativePath);
    await mkdir(dirname(filePath), { recursive: true });

    const existed = await pathExists(filePath);
    if (!overwrite && existed) {
      return {
        path: relativePath,
        changed: false,
        staleArtifactIds: [],
      };
    }

    const before = existed ? await readFile(filePath, "utf8") : undefined;
    if (before === content) {
      return {
        path: relativePath,
        changed: false,
        staleArtifactIds: [],
      };
    }

    await writeFile(filePath, content, "utf8");

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
      path: relativePath,
      changed: true,
      changedArtifactId: changedArtifact?.id,
      staleArtifactIds,
    };
  }

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
    const filePath = this.resolveProjectPath(snapshot, relativePath);
    const before = (await pathExists(filePath)) ? await readFile(filePath, "utf8") : "";
    return createArtifactDiff(relativePath, before, nextContent);
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
    const directoryPath = this.resolveProjectPath(snapshot, relativePath);
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const entryRelativePath = joinProjectPath(relativePath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listDirectoryFiles(snapshot, entryRelativePath)));
      } else {
        files.push(entryRelativePath);
      }
    }

    return files.sort((a, b) => a.localeCompare(b));
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

  private requireProject(snapshot: SessionSnapshot) {
    if (!snapshot.project) throw new Error("Project sandbox has not been initialized.");
    return snapshot.project;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function joinProjectPath(directory: string, fileName: string): string {
  const normalizedDirectory = directory.replace(/\\/g, "/").replace(/\/$/, "");
  return normalizedDirectory ? `${normalizedDirectory}/${fileName}` : fileName;
}
