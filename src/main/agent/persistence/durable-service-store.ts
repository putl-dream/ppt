import { join } from "node:path";
import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { PresentationCommand } from "@shared/commands";
import type { AgentConversationMessage } from "@shared/session-recovery";
import type { CommitGateResult } from "../gate/commit-gate";
import { readJsonFile, writeJsonFileAtomic, writeTextFileAtomic } from "./atomic-json-file";

interface DurableMemoryEntry {
  threadId: string;
  status: DurableServiceThread["status"];
  objective: string;
  outcome?: string;
  updatedAt: string;
}

export interface DurablePendingApproval {
  commands: PresentationCommand[];
  summary: string;
  assumptions?: string[];
  modelRisk: "low" | "medium" | "high";
  baseRevision: number;
  gate: CommitGateResult;
}

export interface DurableServiceThread {
  version: 1;
  threadId: string;
  status: "active" | "waiting_user" | "waiting_approval" | "completed" | "rejected" | "interrupted";
  messages: AgentConversationMessage[];
  model?: AgentModelSelection;
  executionStrategy: AgentExecutionStrategy;
  pendingApproval?: DurablePendingApproval;
  updatedAt: string;
}

function safeThreadId(threadId: string): string {
  return threadId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "thread";
}

export class DurableServiceStore {
  constructor(private readonly workspaceRoot: string) {}

  private pathFor(threadId: string): string {
    return join(this.workspaceRoot, ".agent", "service", `${safeThreadId(threadId)}.json`);
  }

  async load(threadId: string): Promise<DurableServiceThread | undefined> {
    const state = await readJsonFile<DurableServiceThread>(this.pathFor(threadId));
    if (!state || state.version !== 1 || state.threadId !== threadId) return undefined;
    return state;
  }

  async save(state: DurableServiceThread): Promise<void> {
    await writeJsonFileAtomic(this.pathFor(state.threadId), state);
    await this.updateMemoryState(state);
  }

  private async updateMemoryState(state: DurableServiceThread): Promise<void> {
    const statePath = join(this.workspaceRoot, ".memory", "STATE.json");
    const markdownPath = join(this.workspaceRoot, ".memory", "STATE.md");
    const existing = await readJsonFile<{ version: 1; entries: DurableMemoryEntry[] }>(statePath)
      ?? { version: 1 as const, entries: [] };
    const objective = [...state.messages].reverse()
      .find((message) => message.role === "user")?.content.trim().slice(0, 1_000) ?? "";
    const outcome = [...state.messages].reverse()
      .find((message) => message.role === "assistant")?.content.trim().slice(0, 1_000);
    const entry: DurableMemoryEntry = {
      threadId: state.threadId,
      status: state.status,
      objective,
      outcome: outcome || undefined,
      updatedAt: state.updatedAt,
    };
    const entries = [
      entry,
      ...existing.entries.filter((item) => item.threadId !== state.threadId),
    ].slice(0, 20);
    await writeJsonFileAtomic(statePath, { version: 1, entries });
    const markdown = [
      "# Durable Agent State",
      "",
      "This file is generated from committed Agent service state. It stores goals and outcomes, not hidden chain-of-thought.",
      "",
      ...entries.flatMap((item) => [
        `## ${item.updatedAt} · ${item.status}`,
        `- Thread: ${item.threadId}`,
        `- Objective: ${item.objective || "(not recorded)"}`,
        ...(item.outcome ? [`- Outcome: ${item.outcome}`] : []),
        "",
      ]),
    ].join("\n");
    await writeTextFileAtomic(markdownPath, `${markdown.trimEnd()}\n`);
  }
}
