import type {
  AgentModelContentBlock,
  AgentModelGateway,
  AgentModelToolResultBlock,
} from "../gateway/types";
import type { AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import type { TeammateProgressListener } from "@shared/teammate-progress";
import type { TaskGraphSnapshotListener } from "../task/task-graph-publisher";
import type { TaskStore } from "../task/task-store";
import type { AgentMailboxMessage } from "./message-bus";

export type TeammateStatus = "running" | "idle" | "stopped" | "failed";

export interface TeammateHandle {
  name: string;
  role: string;
  status: TeammateStatus;
  startedAt: number;
  lastActiveAt: number;
  lastError?: string;
}

export interface SpawnTeammateThreadOptions {
  name: string;
  role: string;
  prompt: string;
  /** Start by polling the shared board instead of executing prompt as a lead assignment. */
  startIdle?: boolean;
  workspaceRoot: string;
  gateway: AgentModelGateway;
  model?: AgentModelSelection;
  maxSteps?: number;
  agentStepLimits?: AgentStepLimits;
  idlePollMs?: number;
  idleTimeoutMs?: number;
  permissionPollMs?: number;
  /** Current-run listener for publishing durable task board changes. */
  onTaskGraphUpdated?: TaskGraphSnapshotListener;
  /** Current-run listener for publishing teammate reasoning and tool activity. */
  onProgress?: TeammateProgressListener;
  /** Shared durable task board. The board may live outside the project workspace. */
  taskStore?: TaskStore;
}

export type TeammateState = TeammateHandle & {
  controller: AbortController;
  done: Promise<void>;
  prompt: string;
  lastError?: string;
  taskGraphListener?: TaskGraphSnapshotListener;
  progressListener?: TeammateProgressListener;
};

export type AssignmentSource = "spawn-prompt" | "message" | "task-board";

export type AssignmentContext = {
  input: string;
  source: AssignmentSource;
  activityTaskId?: string;
};

export type TeammateIdlePhase = {
  kind: "idle";
  since: number;
  nextPollAt: number;
};

export type TeammateAssignedPhase = {
  kind: "assigned";
  assignment: AssignmentContext;
  activityId: string;
  activityFinished: boolean;
  modelSteps: number;
};

export type TeammateExit =
  | { kind: "idle-timeout" }
  | { kind: "shutdown"; requestId: string; sender: string }
  | { kind: "hook-stop"; reason: string }
  | { kind: "aborted" }
  | { kind: "failed"; error: Error };

export type TeammateTerminalPhase =
  | {
      kind: "stopping";
      exit: Exclude<TeammateExit, { kind: "failed" }>;
      assignment?: TeammateAssignedPhase;
    }
  | {
      kind: "failed";
      exit: Extract<TeammateExit, { kind: "failed" }>;
      assignment?: TeammateAssignedPhase;
    };

export type TeammatePhase =
  | TeammateIdlePhase
  | TeammateAssignedPhase
  | TeammateTerminalPhase;

export type TeammateInboxOutcome =
  | { kind: "none" }
  | { kind: "routed-messages"; messages: AgentMailboxMessage[] }
  | { kind: "shutdown"; requestId: string; sender: string };

export type TeammateToolBatchOutcome =
  | {
      kind: "continue";
      results: AgentModelToolResultBlock[];
      transcriptEntries: Array<Record<string, unknown>>;
    }
  | {
      kind: "stop";
      reason: string;
      transcriptEntries: Array<Record<string, unknown>>;
    };

export type TeammateIdlePollOutcome =
  | { kind: "wait"; idle: TeammateIdlePhase }
  | { kind: "timeout" }
  | { kind: "claimed"; task: AgentTaskNode };

export type TeammateTurnOutcome =
  | {
      kind: "continue";
      assistantContent: AgentModelContentBlock[];
      results: AgentModelToolResultBlock[];
      transcriptEntries: Array<Record<string, unknown>>;
    }
  | {
      kind: "final";
      assistantContent: AgentModelContentBlock[];
      summary: string;
    }
  | {
      kind: "stop-teammate";
      assistantContent: AgentModelContentBlock[];
      reason: string;
      transcriptEntries: Array<Record<string, unknown>>;
    };

export type AssignmentCompletionOutcome =
  | { kind: "completed"; summary: string }
  | { kind: "continue"; guidance: string };

export type PersistedTeammateState = Omit<TeammateHandle, "status"> & {
  status: TeammateStatus | "interrupted";
  prompt: string;
};
