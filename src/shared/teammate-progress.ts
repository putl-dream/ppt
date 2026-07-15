/** User-visible progress emitted by long-lived teammate assignments. */
export type TeammateProgressEvent =
  | {
      type: "teammate-assignment-started";
      teammateName: string;
      activityId: string;
      taskId?: string;
      description: string;
    }
  | {
      type: "teammate-thinking-chunk";
      teammateName: string;
      activityId: string;
      taskId?: string;
      chunk: string;
    }
  | {
      type: "teammate-tool-started";
      teammateName: string;
      activityId: string;
      taskId?: string;
      toolName: string;
      message: string;
    }
  | {
      type: "teammate-tool-finished";
      teammateName: string;
      activityId: string;
      taskId?: string;
      toolName: string;
      message: string;
      status: "completed" | "failed";
    }
  | {
      type: "teammate-assignment-finished";
      teammateName: string;
      activityId: string;
      taskId?: string;
      status: "completed" | "failed" | "interrupted";
      message?: string;
    };

export type TeammateProgressListener = (event: TeammateProgressEvent) => void;

const TEAMMATE_PROGRESS_TYPES = new Set<TeammateProgressEvent["type"]>([
  "teammate-assignment-started",
  "teammate-thinking-chunk",
  "teammate-tool-started",
  "teammate-tool-finished",
  "teammate-assignment-finished",
]);

export function isTeammateProgressEvent(
  event: { type: string },
): event is TeammateProgressEvent {
  return TEAMMATE_PROGRESS_TYPES.has(event.type as TeammateProgressEvent["type"]);
}

export function formatTeammateToolProgress(
  toolName: string,
  status: "running" | "completed" | "failed",
): string {
  if (status === "running") return `正在调用 ${toolName}`;
  if (status === "failed") return `${toolName} 执行失败`;
  return `${toolName} 已完成`;
}
