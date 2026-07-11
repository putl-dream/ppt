import { join } from "node:path";
import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { AgentRuntimeResult } from "../runtime/runtime-types";
import type {
  AgentModelMessage,
  AgentModelToolResultBlock,
  AgentModelToolUseBlock,
} from "../gateway/types";
import { readJsonFile, writeJsonFileAtomic } from "./atomic-json-file";

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
  constructor(private readonly workspaceRoot: string) {}

  pathFor(threadId: string): string {
    return join(this.workspaceRoot, ".agent", "runs", `${safeThreadId(threadId)}.json`);
  }

  async load(threadId: string): Promise<DurableRunCheckpoint | undefined> {
    const checkpoint = await readJsonFile<DurableRunCheckpoint>(this.pathFor(threadId));
    if (!checkpoint || checkpoint.version !== 1 || checkpoint.threadId !== threadId) return undefined;
    return checkpoint;
  }

  async save(checkpoint: DurableRunCheckpoint): Promise<void> {
    await writeJsonFileAtomic(this.pathFor(checkpoint.threadId), checkpoint);
  }
}

