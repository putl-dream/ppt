import { createRequire } from "node:module";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PersistedTaskList } from "./task-store";

type LockRelease = () => Promise<void>;
type ProperLockfile = { lock(file: string, options?: object): Promise<LockRelease> };
const lockfile = createRequire(import.meta.url)("proper-lockfile") as ProperLockfile;

/** Physically removes only explicitly archived task-list directories. */
export class TaskRetentionService {
  constructor(private readonly workspaceRoot: string) {}

  async cleanupArchivedBefore(cutoff: Date): Promise<string[]> {
    const storeRoot = join(this.workspaceRoot, ".tasks");
    const release = await lockfile.lock(join(this.workspaceRoot, ".task-storage-cleanup"), {
      realpath: false,
      stale: 30_000,
      retries: { retries: 20, factor: 1, minTimeout: 10, maxTimeout: 100 },
    });
    const removed: string[] = [];
    try {
      const marker = JSON.parse(await readFile(join(storeRoot, "schema.json"), "utf8")) as {
        format?: string;
        version?: number;
      };
      if (marker.format !== "task-store" || marker.version !== 1) return removed;
      for (const entry of await readdir(storeRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = join(storeRoot, entry.name);
        let list: PersistedTaskList;
        try {
          list = JSON.parse(await readFile(join(directory, "tasks.json"), "utf8")) as PersistedTaskList;
        } catch {
          continue;
        }
        if (list.format !== "task-list"
          || list.version !== 1
          || list.state !== "archived"
          || !list.archive
          || Date.parse(list.archive.archivedAt) > cutoff.getTime()) {
          continue;
        }
        await rm(directory, { recursive: true, force: false });
        removed.push(list.identity.taskListId);
      }
      return removed;
    } finally {
      await release();
    }
  }
}
