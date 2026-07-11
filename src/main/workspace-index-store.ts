import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  getWorkspaceMetaDir,
  getWorkspaceProjectPath,
  getWorkspaceSessionSnapshotPath,
  getWorkspaceSessionsIndexPath,
  workspaceProjectMetaSchema,
  workspaceSessionSnapshotSchema,
  workspaceSessionsIndexSchema,
  type WorkspaceProjectMeta,
  type WorkspaceSessionIndexEntry,
  type WorkspaceSessionsIndex,
  type WorkspaceSessionSnapshot,
} from "@shared/workspace-meta";
import type { SessionSnapshot } from "@shared/session";
import { repairPresentationGeometry } from "@shared/presentation-repair";
import { normalizeWorkspacePath, compareSessionsByActivity } from "@shared/workspace";

export class WorkspaceIndexStore {
  async ensureProjectMeta(rootPath: string, title: string): Promise<WorkspaceProjectMeta> {
    const normalized = normalizeWorkspacePath(rootPath);
    const existing = await this.readProjectMeta(normalized);
    const now = new Date().toISOString();
    if (existing) {
      const next: WorkspaceProjectMeta = {
        ...existing,
        title: title || existing.title,
        updatedAt: now,
      };
      await this.writeProjectMeta(normalized, next);
      return next;
    }

    const created: WorkspaceProjectMeta = {
      version: 1,
      title,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeProjectMeta(normalized, created);
    return created;
  }

  async readProjectMeta(rootPath: string): Promise<WorkspaceProjectMeta | null> {
    return this.readJsonFile(getWorkspaceProjectPath(rootPath), workspaceProjectMetaSchema);
  }

  async readSessionsIndex(rootPath: string): Promise<WorkspaceSessionsIndex | null> {
    return this.readJsonFile(getWorkspaceSessionsIndexPath(rootPath), workspaceSessionsIndexSchema);
  }

  async writeSessionsIndex(
    rootPath: string,
    index: WorkspaceSessionsIndex,
  ): Promise<void> {
    await this.writeJsonFile(getWorkspaceSessionsIndexPath(rootPath), index);
  }

  async readSessionSnapshot(
    rootPath: string,
    sessionId: string,
  ): Promise<WorkspaceSessionSnapshot | null> {
    const filePath = getWorkspaceSessionSnapshotPath(rootPath, sessionId);
    try {
      const raw = JSON.parse(await readFile(filePath, "utf8"));
      const repaired = repairWorkspaceSnapshotGeometry(raw);
      const parsed = workspaceSessionSnapshotSchema.parse(repaired.value);
      if (repaired.repairedDimensionCount > 0) {
        await this.writeSessionSnapshot(rootPath, parsed);
      }
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  async writeSessionSnapshot(
    rootPath: string,
    snapshot: WorkspaceSessionSnapshot,
  ): Promise<void> {
    await this.writeJsonFile(
      getWorkspaceSessionSnapshotPath(rootPath, snapshot.session.id),
      snapshot,
    );
  }

  entryFromSnapshot(snapshot: SessionSnapshot): WorkspaceSessionIndexEntry {
    if (!snapshot.project || !snapshot.transcript) {
      throw new Error("Workspace session snapshot is missing project or transcript metadata.");
    }

    return {
      id: snapshot.session.id,
      title: snapshot.session.title,
      createdAt: snapshot.session.createdAt,
      updatedAt: snapshot.session.updatedAt,
      lastMessageAt: snapshot.session.lastMessageAt,
      slideCount: snapshot.session.slideCount,
      revision: snapshot.session.revision,
      transcriptPath: snapshot.transcript.path,
      leafMessageUuid: snapshot.transcript.leafMessageUuid,
    };
  }

  snapshotFromSession(snapshot: SessionSnapshot): WorkspaceSessionSnapshot {
    if (!snapshot.project) {
      throw new Error("Workspace session snapshot is missing project metadata.");
    }

    const { workspacePath: _, ...session } = snapshot.session;
    return workspaceSessionSnapshotSchema.parse({
      version: 1,
      session,
      presentation: snapshot.presentation,
      messages: snapshot.messages,
      project: snapshot.project,
      transcript: snapshot.transcript,
    });
  }

  sessionFromWorkspaceSnapshot(
    stored: WorkspaceSessionSnapshot,
    workspacePath: string,
  ): SessionSnapshot {
    return {
      session: {
        ...stored.session,
        workspacePath,
      },
      presentation: structuredClone(stored.presentation),
      messages: structuredClone(stored.messages),
      project: structuredClone(stored.project),
      transcript: stored.transcript ? structuredClone(stored.transcript) : undefined,
    };
  }

  async upsertSession(
    rootPath: string,
    snapshot: SessionSnapshot,
    options?: { active?: boolean },
  ): Promise<WorkspaceSessionsIndex> {
    const normalized = normalizeWorkspacePath(rootPath);
    await mkdir(getWorkspaceMetaDir(normalized), { recursive: true });
    await this.writeSessionSnapshot(normalized, this.snapshotFromSession(snapshot));

    const entry = this.entryFromSnapshot(snapshot);
    const existing = (await this.readSessionsIndex(normalized)) ?? {
      version: 1 as const,
      activeSessionId: entry.id,
      sessions: [],
    };

    const sessions = [
      entry,
      ...existing.sessions.filter((item) => item.id !== entry.id),
    ].sort((left, right) => compareSessionsByActivity(left, right));

    const next: WorkspaceSessionsIndex = {
      version: 1,
      activeSessionId: options?.active === false
        ? existing.activeSessionId
        : entry.id,
      sessions,
    };

    if (!sessions.some((item) => item.id === next.activeSessionId)) {
      next.activeSessionId = sessions[0]?.id ?? entry.id;
    }

    await this.writeSessionsIndex(normalized, next);
    return next;
  }

  async removeSession(rootPath: string, sessionId: string): Promise<WorkspaceSessionsIndex | null> {
    const normalized = normalizeWorkspacePath(rootPath);
    const existing = await this.readSessionsIndex(normalized);
    if (!existing) return null;

    const sessions = existing.sessions.filter((item) => item.id !== sessionId);
    if (sessions.length === existing.sessions.length) return existing;

    const next: WorkspaceSessionsIndex = {
      version: 1,
      activeSessionId: existing.activeSessionId === sessionId
        ? (sessions[0]?.id ?? "")
        : existing.activeSessionId,
      sessions,
    };

    if (sessions.length === 0) {
      await this.writeSessionsIndex(normalized, next);
      return next;
    }

    await this.writeSessionsIndex(normalized, next);
    return next;
  }

  async setActiveSession(rootPath: string, sessionId: string): Promise<void> {
    const normalized = normalizeWorkspacePath(rootPath);
    const existing = await this.readSessionsIndex(normalized);
    if (!existing || !existing.sessions.some((item) => item.id === sessionId)) return;

    await this.writeSessionsIndex(normalized, {
      ...existing,
      activeSessionId: sessionId,
    });
  }

  private async writeProjectMeta(rootPath: string, meta: WorkspaceProjectMeta): Promise<void> {
    await this.writeJsonFile(getWorkspaceProjectPath(rootPath), meta);
  }

  private async readJsonFile<T>(
    filePath: string,
    schema: { parse: (value: unknown) => T },
  ): Promise<T | null> {
    try {
      const raw = JSON.parse(await readFile(filePath, "utf8"));
      return schema.parse(raw);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, payload, "utf8");
    await rename(temporaryPath, filePath);
  }
}

function repairWorkspaceSnapshotGeometry(value: unknown): {
  value: unknown;
  repairedDimensionCount: number;
} {
  if (typeof value !== "object" || value === null || !("presentation" in value)) {
    return { value, repairedDimensionCount: 0 };
  }
  const repaired = { ...value } as Record<string, unknown>;
  const geometry = repairPresentationGeometry(repaired.presentation);
  repaired.presentation = geometry.value;
  return {
    value: repaired,
    repairedDimensionCount: geometry.repairedDimensionCount,
  };
}
