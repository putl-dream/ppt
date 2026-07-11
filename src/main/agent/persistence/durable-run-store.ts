import { join } from "node:path";
import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { AgentRuntimeResult } from "../runtime/runtime-types";
import type {
  AgentModelMessage,
  AgentModelToolResultBlock,
  AgentModelToolUseBlock,
} from "../gateway/types";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file";
import { ConversationDatabase } from "../../conversation-database";

export type DurableRunStatus =
  | "running"
  | "waiting_user"
  | "proposal_ready"
  | "completed"
  | "interrupted"
  | "failed";

export type DurableRunPhase =
  | "before_model"
  | "model_committed"
  | "tool_running"
  | "tool_committed"
  | "finished";

export interface DurableRunCheckpoint {
  version: 1;
  threadId: string;
  runId?: string;
  status: DurableRunStatus;
  phase: DurableRunPhase;
  request: string;
  model?: AgentModelSelection;
  executionStrategy?: AgentExecutionStrategy;
  baseRevision: number;
  modelStep: number;
  modelMessages: AgentModelMessage[];
  transcript: Array<Record<string, unknown>>;
  queuedToolUses: AgentModelToolUseBlock[];
  pendingToolResults: AgentModelToolResultBlock[];
  pendingUserContent: string[];
  discoveredToolNames: string[];
  loadedSkillNames: string[];
  renderFeedbackUsed: boolean;
  activeToolUse?: AgentModelToolUseBlock;
  result?: AgentRuntimeResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

function safeThreadId(threadId: string): string {
  return threadId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "thread";
}

export class DurableRunStore {
  constructor(private readonly storage: string | ConversationDatabase) {}

  pathFor(threadId: string): string {
    if (typeof this.storage !== "string") {
      throw new Error("SQLite-backed run checkpoints do not have workspace paths.");
    }
    return join(this.storage, ".agent", "runs", `${safeThreadId(threadId)}.json`);
  }

  async load(threadId: string): Promise<DurableRunCheckpoint | undefined> {
    if (typeof this.storage !== "string") {
      const checkpoint = this.storage.loadRunCheckpoint<DurableRunCheckpoint>(threadId);
      if (!checkpoint || checkpoint.version !== 1 || checkpoint.threadId !== threadId) return undefined;
      return checkpoint;
    }
    const checkpoint = await readJsonFile<DurableRunCheckpoint>(this.pathFor(threadId));
    if (!checkpoint || checkpoint.version !== 1 || checkpoint.threadId !== threadId) return undefined;
    return checkpoint;
  }

  async save(checkpoint: DurableRunCheckpoint): Promise<void> {
    if (typeof this.storage !== "string") {
      this.storage.saveRunCheckpoint(checkpoint.threadId, checkpoint, checkpoint.runId);
      return;
    }
    await writeJsonFileAtomic(this.pathFor(checkpoint.threadId), checkpoint);
  }
}
