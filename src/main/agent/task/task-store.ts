import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  agentTaskNodeSchema,
  canStartTask,
  findUnblockedPendingTasks,
  getIncompleteBlockedBy,
  hasDependencyCycle,
  TASKS_DIR_NAME,
  type AgentTaskNode,
} from "@shared/agent-task-graph";
import { resolveAgentPath } from "../subagent/workspace-path";

const META_FILE = "_meta.json";

type TaskMeta = {
  idCounter: number;
};

export type CreateTaskInput = {
  subject: string;
  description?: string;
  blockedBy?: string[];
};

export type CreateTaskResult =
  | { ok: true; task: AgentTaskNode }
  | { ok: false; error: string };

export type ClaimTaskResult =
  | { ok: true; message: string; task: AgentTaskNode }
  | { ok: false; error: string };

export type CompleteTaskResult =
  | { ok: true; message: string; task: AgentTaskNode; unblocked: string[] }
  | { ok: false; error: string };

/** File-backed task graph stored under `{workspaceRoot}/.tasks/`. */
export class TaskStore {
  private readonly tasksDir: string;

  constructor(private readonly workspaceRoot: string) {
    this.tasksDir = resolveAgentPath(workspaceRoot, TASKS_DIR_NAME);
  }

  async createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
    await this.ensureTasksDir();
    const blockedBy = input.blockedBy ?? [];
    const existing = await this.listTasks();

    for (const depId of blockedBy) {
      if (!existing.some((task) => task.id === depId)) {
        return { ok: false, error: `Dependency not found: ${depId}` };
      }
    }

    const id = await this.nextTaskId();
    const now = new Date().toISOString();
    const candidate: AgentTaskNode = {
      id,
      subject: input.subject.trim(),
      description: input.description?.trim() ?? "",
      status: "pending",
      owner: null,
      blockedBy,
      createdAt: now,
      updatedAt: now,
    };

    if (hasDependencyCycle([...existing, candidate])) {
      return { ok: false, error: "blockedBy would create a dependency cycle" };
    }

    await this.saveTask(candidate);
    return { ok: true, task: candidate };
  }

  async listTasks(): Promise<AgentTaskNode[]> {
    await this.ensureTasksDir();
    const entries = await readdir(this.tasksDir, { withFileTypes: true });
    const tasks: AgentTaskNode[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === META_FILE) {
        continue;
      }
      tasks.push(await this.loadTask(entry.name.replace(/\.json$/, "")));
    }

    return tasks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getTask(taskId: string): Promise<AgentTaskNode> {
    return this.loadTask(taskId);
  }

  async canStart(taskId: string): Promise<boolean> {
    const tasks = await this.listTasks();
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const task = tasksById.get(taskId);
    if (!task) return false;
    return canStartTask(task, tasksById);
  }

  async claimTask(taskId: string, owner = "agent"): Promise<ClaimTaskResult> {
    const task = await this.loadTask(taskId);
    if (task.status !== "pending") {
      return { ok: false, error: `Task ${taskId} is ${task.status}, cannot claim` };
    }

    const tasks = await this.listTasks();
    const tasksById = new Map(tasks.map((item) => [item.id, item]));
    if (!canStartTask(task, tasksById)) {
      const blocked = getIncompleteBlockedBy(task, tasksById);
      return { ok: false, error: `Blocked by: ${blocked.join(", ") || "missing dependencies"}` };
    }

    task.owner = owner;
    task.status = "in_progress";
    task.updatedAt = new Date().toISOString();
    await this.saveTask(task);
    return {
      ok: true,
      message: `Claimed ${taskId} (${task.subject})`,
      task,
    };
  }

  async completeTask(taskId: string): Promise<CompleteTaskResult> {
    const task = await this.loadTask(taskId);
    if (task.status !== "in_progress") {
      return { ok: false, error: `Task ${taskId} is ${task.status}, cannot complete` };
    }

    task.status = "completed";
    task.owner = null;
    task.updatedAt = new Date().toISOString();
    await this.saveTask(task);

    const unblocked = findUnblockedPendingTasks(await this.listTasks()).map((item) => item.subject);
    let message = `Completed ${taskId} (${task.subject})`;
    if (unblocked.length > 0) {
      message += `\nUnblocked: ${unblocked.join(", ")}`;
    }

    return { ok: true, message, task, unblocked };
  }

  /** Release in-progress tasks owned by an agent back to pending. */
  async unassignInProgressByOwner(owner: string): Promise<string[]> {
    const released: string[] = [];
    const tasks = await this.listTasks();
    for (const task of tasks) {
      if (task.status !== "in_progress" || task.owner !== owner) continue;
      task.status = "pending";
      task.owner = null;
      task.updatedAt = new Date().toISOString();
      await this.saveTask(task);
      released.push(task.id);
    }
    return released;
  }

  private async ensureTasksDir(): Promise<void> {
    await mkdir(this.tasksDir, { recursive: true });
  }

  private taskPath(taskId: string): string {
    return join(this.tasksDir, `${taskId}.json`);
  }

  private metaPath(): string {
    return join(this.tasksDir, META_FILE);
  }

  private async loadMeta(): Promise<TaskMeta> {
    try {
      const raw = await readFile(this.metaPath(), "utf8");
      const parsed = JSON.parse(raw) as TaskMeta;
      if (typeof parsed.idCounter !== "number" || parsed.idCounter < 0) {
        return { idCounter: 0 };
      }
      return parsed;
    } catch {
      return { idCounter: 0 };
    }
  }

  private async saveMeta(meta: TaskMeta): Promise<void> {
    await writeFile(this.metaPath(), JSON.stringify(meta, null, 2), "utf8");
  }

  private async nextTaskId(): Promise<string> {
    const meta = await this.loadMeta();
    meta.idCounter += 1;
    await this.saveMeta(meta);
    return `task_${meta.idCounter}_${randomBytes(2).toString("hex")}`;
  }

  private async loadTask(taskId: string): Promise<AgentTaskNode> {
    const raw = await readFile(this.taskPath(taskId), "utf8");
    return agentTaskNodeSchema.parse(JSON.parse(raw));
  }

  private async saveTask(task: AgentTaskNode): Promise<void> {
    await this.ensureTasksDir();
    await writeFile(this.taskPath(task.id), JSON.stringify(task, null, 2), "utf8");
  }
}

export function createTaskStore(workspaceRoot: string | undefined): TaskStore | undefined {
  if (!workspaceRoot?.trim()) return undefined;
  return new TaskStore(workspaceRoot);
}
