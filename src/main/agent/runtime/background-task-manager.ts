export interface BackgroundTaskNotification {
  bgId: string;
  toolName: string;
  label: string;
  status: "completed" | "failed";
  content: string;
  isError: boolean;
}

interface BackgroundTaskRecord {
  bgId: string;
  toolName: string;
  label: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
}

export class BackgroundTaskManager {
  private counter = 0;
  private readonly tasks = new Map<string, BackgroundTaskRecord>();
  private readonly done: BackgroundTaskNotification[] = [];

  start(input: {
    toolName: string;
    label: string;
    run: () => Promise<unknown>;
  }): string {
    this.counter += 1;
    const bgId = `bg_${String(this.counter).padStart(4, "0")}`;
    this.tasks.set(bgId, {
      bgId,
      toolName: input.toolName,
      label: input.label,
      status: "running",
      startedAt: Date.now(),
    });

    void input.run().then(
      (result) => this.settle(bgId, stringifyBackgroundResult(result), false),
      (error) => this.settle(bgId, error instanceof Error ? error.message : String(error), true),
    );

    return bgId;
  }

  hasRunning(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status === "running") return true;
    }
    return false;
  }

  hasPendingNotifications(): boolean {
    return this.done.length > 0;
  }

  collect(): BackgroundTaskNotification[] {
    const ready = this.done.splice(0, this.done.length);
    for (const notification of ready) {
      this.tasks.delete(notification.bgId);
    }
    return ready;
  }

  async drain(signal?: AbortSignal): Promise<BackgroundTaskNotification[]> {
    while (this.hasRunning()) {
      if (signal?.aborted) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return this.collect();
  }

  private settle(bgId: string, content: string, isError: boolean): void {
    const task = this.tasks.get(bgId);
    if (!task) return;
    task.status = isError ? "failed" : "completed";
    this.done.push({
      bgId,
      toolName: task.toolName,
      label: task.label,
      status: task.status,
      content,
      isError,
    });
  }
}

export function shouldRunBackground(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (args.run_in_background === true) {
    return toolName === "Task";
  }

  if (toolName === "Task" && Array.isArray(args.descriptions)) {
    return args.descriptions.filter((item) => typeof item === "string" && item.trim()).length > 1;
  }

  return false;
}

export function describeBackgroundTask(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === "Task") {
    if (Array.isArray(args.descriptions)) {
      const count = args.descriptions.filter((item) => typeof item === "string" && item.trim()).length;
      return `Task: ${count} parallel subtasks`;
    }
    if (typeof args.description === "string" && args.description.trim()) {
      return `Task: ${truncateForNotification(args.description.trim(), 80)}`;
    }
  }
  return toolName;
}

export function formatBackgroundNotifications(
  notifications: BackgroundTaskNotification[],
): string {
  return notifications.map((notification) => {
    const tagName = notification.isError ? "error" : "summary";
    return [
      "<task_notification>",
      `  <task_id>${escapeXml(notification.bgId)}</task_id>`,
      `  <status>${notification.status}</status>`,
      `  <tool>${escapeXml(notification.toolName)}</tool>`,
      `  <label>${escapeXml(notification.label)}</label>`,
      `  <${tagName}>${escapeXml(truncateForNotification(notification.content, 1_000))}</${tagName}>`,
      "</task_notification>",
    ].join("\n");
  }).join("\n\n");
}

function stringifyBackgroundResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result ?? null);
  } catch {
    return String(result);
  }
}

function truncateForNotification(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
