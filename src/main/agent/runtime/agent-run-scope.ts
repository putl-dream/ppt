import type { ConversationDatabase } from "../../conversation-database";
import { filterTasksByPlan } from "@shared/agent-task-graph";
import type { AgentModelMessage } from "../gateway/types";
import {
  type DurableRunCheckpoint,
  type DurableRunPhase,
  type DurableRunStatus,
  DurableRunStore,
} from "../persistence/durable-run-store";
import { createTaskStore } from "../task/task-store";
import type { ToolDiscoverySession } from "../tools/tool-definition";
import type { SkillSession } from "../skills/skill-types";
import type { AgentRuntimeOptions, AgentRuntimeResult } from "./runtime-types";
import { AgentEventPorts } from "./agent-event-ports";
import { AgentSession } from "./agent-session";
import { BackgroundTaskManager } from "./background-task-manager";
import { CheckpointCoordinator } from "./checkpoint-coordinator";
import { CheckpointPolicy } from "./checkpoint-policy";

export interface AgentRunScopeOpenInput {
  options: AgentRuntimeOptions;
  conversationDatabase?: ConversationDatabase;
  resolveDiscoverySession(recovered?: DurableRunCheckpoint): ToolDiscoverySession;
  resolveSkillSession(recovered?: DurableRunCheckpoint): SkillSession;
}

/**
 * Owns every resource whose lifetime is bounded by one AgentRuntime invocation.
 * `open()` rolls back partial acquisition; `close()` is idempotent and best effort.
 */
export class AgentRunScope {
  static async open(input: AgentRunScopeOpenInput): Promise<AgentRunScope> {
    const { options } = input;
    const abortController = new AbortController();
    const forwardAbort = (): void => abortController.abort(options.signal?.reason);
    if (options.signal?.aborted) forwardAbort();
    else options.signal?.addEventListener("abort", forwardAbort, { once: true });

    let checkpoints: CheckpointCoordinator | undefined;
    try {
      const durableRunStore = input.conversationDatabase
        ? new DurableRunStore(input.conversationDatabase)
        : options.workspaceRoot
          ? new DurableRunStore(options.workspaceRoot)
          : undefined;
      const runId = options.runId ?? crypto.randomUUID();
      const openedCheckpoint = durableRunStore
        ? await durableRunStore.openLease({
            threadId: options.threadId,
            runId,
            resume: options.resumeThread === true,
          })
        : undefined;
      if (openedCheckpoint?.type === "lease_busy") {
        throw new Error(
          `Agent thread ${options.threadId} is already owned by active run ${openedCheckpoint.activeRunId}.`,
        );
      }

      const recovered = openedCheckpoint?.type === "opened"
        ? openedCheckpoint.checkpoint
        : undefined;
      checkpoints = new CheckpointCoordinator(
        durableRunStore,
        openedCheckpoint?.type === "opened" ? openedCheckpoint.lease : undefined,
        openedCheckpoint?.type === "opened" ? openedCheckpoint.currentRevision : 0,
      );

      const transcript: Array<Record<string, unknown>> = recovered
        ? [...structuredClone(recovered.transcript), { role: "user", content: options.request }]
        : [{ role: "user", content: options.request }];
      const modelMessages: AgentModelMessage[] = recovered
        ? structuredClone(recovered.modelMessages)
        : [
            ...(options.messageHistory ?? []).map((entry) => ({
              role: entry.role,
              content: [{ type: "text" as const, text: entry.content }],
            })),
            { role: "user", content: [{ type: "text", text: options.request }] },
          ];
      const session = new AgentSession({
        transcript,
        modelMessages,
        queuedToolUses: structuredClone(recovered?.queuedToolUses ?? []),
        pendingToolResults: structuredClone(recovered?.pendingToolResults ?? []),
        pendingUserContent: [...(recovered?.pendingUserContent ?? [])],
        processedInboxMessageIds: recovered?.processedInboxMessageIds,
        renderFeedbackUsed: recovered?.renderFeedbackUsed,
        activeToolUse: recovered?.activeToolUse
          ? structuredClone(recovered.activeToolUse)
          : undefined,
        phase: recovered?.phase,
        totalModelSteps: recovered?.modelStep,
      });
      const backgroundTasks = new BackgroundTaskManager({
        runId,
        recovered: recovered?.backgroundTasks,
      });
      const eventPorts = new AgentEventPorts({
        threadId: options.threadId,
        runId,
        onProgress: options.onProgress,
        conversationDatabase: input.conversationDatabase,
        appendTranscript: (entry) => session.appendTranscript(entry),
      });
      const scope = new AgentRunScope({
        options,
        abortController,
        forwardAbort,
        runId,
        recovered,
        checkpointCreatedAt: recovered?.createdAt ?? new Date().toISOString(),
        checkpoints,
        session,
        backgroundTasks,
        eventPorts,
        discoverySession: input.resolveDiscoverySession(recovered),
        skillSession: input.resolveSkillSession(recovered),
      });
      scope.restoreRecoverableState();
      scope.attachBackgroundCheckpoint();
      return scope;
    } catch (error) {
      abortController.abort(error);
      options.signal?.removeEventListener("abort", forwardAbort);
      if (checkpoints) {
        try {
          await checkpoints.close();
        } catch {
          // Partial-open rollback cannot replace the acquisition error.
        }
      }
      throw error;
    }
  }

  readonly options: AgentRuntimeOptions;
  readonly runId: string;
  readonly recovered?: DurableRunCheckpoint;
  readonly checkpoints: CheckpointCoordinator;
  readonly session: AgentSession;
  readonly backgroundTasks: BackgroundTaskManager;
  readonly eventPorts: AgentEventPorts;
  readonly discoverySession: ToolDiscoverySession;
  readonly skillSession: SkillSession;
  readonly taskStore;
  readonly taskGraphOwner: string;
  readonly checkpointPolicy = new CheckpointPolicy();

  private readonly abortController: AbortController;
  private readonly forwardAbort: () => void;
  private readonly checkpointCreatedAt: string;
  private closed = false;

  private constructor(input: {
    options: AgentRuntimeOptions;
    abortController: AbortController;
    forwardAbort: () => void;
    runId: string;
    recovered?: DurableRunCheckpoint;
    checkpointCreatedAt: string;
    checkpoints: CheckpointCoordinator;
    session: AgentSession;
    backgroundTasks: BackgroundTaskManager;
    eventPorts: AgentEventPorts;
    discoverySession: ToolDiscoverySession;
    skillSession: SkillSession;
  }) {
    this.options = input.options;
    this.abortController = input.abortController;
    this.forwardAbort = input.forwardAbort;
    this.runId = input.runId;
    this.recovered = input.recovered;
    this.checkpointCreatedAt = input.checkpointCreatedAt;
    this.checkpoints = input.checkpoints;
    this.session = input.session;
    this.backgroundTasks = input.backgroundTasks;
    this.eventPorts = input.eventPorts;
    this.discoverySession = input.discoverySession;
    this.skillSession = input.skillSession;
    this.taskStore = createTaskStore(input.options.runtimeRoot);
    this.taskGraphOwner = input.options.taskGraphOwner ?? "agent";
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  abort(reason?: unknown): void {
    this.abortController.abort(reason);
  }

  applyTransition(transition: Parameters<AgentSession["apply"]>[0]) {
    this.session.apply(transition);
    return this.checkpointPolicy.afterTransition(transition);
  }

  createCheckpoint(input?: {
    status?: DurableRunStatus;
    phase?: DurableRunPhase;
    result?: AgentRuntimeResult;
    error?: string;
  }): DurableRunCheckpoint {
    const now = new Date().toISOString();
    return {
      version: 1,
      threadId: this.options.threadId,
      runId: this.runId,
      status: input?.status ?? this.session.terminalState?.status ?? "running",
      phase: input?.phase ?? (this.session.terminalState ? "finished" : this.session.phase),
      request: this.options.request,
      model: this.options.model,
      executionStrategy: this.options.executionStrategy,
      baseRevision: this.options.presentationSnapshot.revision,
      modelStep: this.session.totalModelSteps,
      modelMessages: structuredClone([...this.session.modelMessages]),
      transcript: structuredClone([...this.session.transcript]),
      queuedToolUses: structuredClone([...this.session.queuedToolUses]),
      pendingToolResults: structuredClone([...this.session.pendingToolResults]),
      pendingUserContent: [...this.session.pendingUserContent],
      discoveredToolNames: [...this.discoverySession.discoveredToolNames].sort(),
      loadedSkillNames: [...this.skillSession.loadedSkillNames].sort(),
      renderFeedbackUsed: this.session.renderFeedbackUsed,
      activeToolUse: this.session.activeToolUse
        ? structuredClone(this.session.activeToolUse)
        : undefined,
      backgroundTasks: this.backgroundTasks.snapshot(),
      processedInboxMessageIds: [...this.session.processedInboxMessageIds].sort(),
      result: input?.result ?? this.session.terminalState?.result,
      error: input?.error ?? this.session.terminalState?.error,
      createdAt: this.checkpointCreatedAt,
      updatedAt: now,
    };
  }

  async persistCheckpoint(
    input?: Parameters<AgentRunScope["createCheckpoint"]>[0],
  ): Promise<void> {
    await this.checkpoints.commit(this.createCheckpoint(input));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.abortController.abort();
    this.options.signal?.removeEventListener("abort", this.forwardAbort);
    this.backgroundTasks.setOnStateChange(undefined);

    try {
      await this.checkpoints.close();
    } catch (error) {
      this.warn(`Checkpoint cleanup failed: ${errorMessage(error)}`);
    }
    try {
      if (!this.taskStore) return;
      const released = await this.taskStore.unassignInProgressByOwner(this.taskGraphOwner);
      if (released.length === 0) return;
      const plan = await this.taskStore.getPlanMeta();
      const tasks = filterTasksByPlan(await this.taskStore.listTasks(), plan?.planId);
      this.eventPorts.renderer({
        type: "task-graph-updated",
        message: "任务图已更新",
        tasks,
        goal: plan?.goal ?? null,
      });
    } catch (error) {
      this.warn(`Runtime cleanup failed: ${errorMessage(error)}`);
    }
  }

  private attachBackgroundCheckpoint(): void {
    this.backgroundTasks.setOnStateChange(async () => {
      try {
        await this.persistCheckpoint();
      } catch (error) {
        this.session.appendTranscript({
          role: "system",
          kind: "background_checkpoint_error",
          content: errorMessage(error),
        });
      }
    });
  }

  private restoreRecoverableState(): void {
    const { recovered, session } = this;
    if (recovered?.phase === "tool_running" && session.activeToolUse) {
      const activeToolUse = session.activeToolUse;
      const alreadyRecorded = session.pendingToolResults.some(
        (item) => item.toolUseId === activeToolUse.id,
      );
      if (!alreadyRecorded) {
        session.replacePendingToolResults([...session.pendingToolResults, {
          type: "tool_result",
          toolUseId: activeToolUse.id,
          isError: true,
          content: [{
            type: "text",
            text: "The application restarted while this tool was running. Its side effects are uncertain. Inspect durable workspace artifacts and task state before deciding whether to retry; do not assume either success or failure.",
          }],
        }]);
      }
      session.appendTranscript({
        role: "system",
        kind: "recovery",
        toolUseId: activeToolUse.id,
        toolName: activeToolUse.name,
        content: "Recovered an interrupted tool boundary; side effects require reconciliation.",
      });
      session.clearActiveTool();
      session.setPhase("tool_committed");
    }

    if (
      recovered
      && recovered.backgroundTasks === undefined
      && (recovered.status === "running" || recovered.status === "interrupted" || recovered.status === "failed")
    ) {
      const interruptedBackgroundTasks = recovered.transcript.flatMap((entry) => {
        const result = entry.result;
        if (!result || typeof result !== "object" || Array.isArray(result)) return [];
        const record = result as Record<string, unknown>;
        if (record.status !== "running" || typeof record.backgroundTaskId !== "string") return [];
        return [{
          id: record.backgroundTaskId,
          toolName: typeof entry.toolName === "string" ? entry.toolName : "background-task",
        }];
      });
      if (interruptedBackgroundTasks.length > 0) {
        const recoveryNotice = interruptedBackgroundTasks.map((task) => [
          "<task_notification>",
          `  <task_id>${task.id}</task_id>`,
          "  <status>failed</status>",
          `  <tool>${task.toolName}</tool>`,
          "  <error>The application restarted before this background task committed its result. Inspect durable artifacts before retrying.</error>",
          "</task_notification>",
        ].join("\n")).join("\n\n");
        session.appendPendingUserContent(recoveryNotice);
        session.appendTranscript({ role: "system", kind: "recovery", content: recoveryNotice });
      }
    }

    if (!recovered) return;
    const continuationText = [this.options.request, ...session.takePendingUserContent()]
      .filter((part) => part.trim())
      .join("\n\n");
    if (session.phase === "model_committed" && session.queuedToolUses.length > 0) {
      session.appendPendingUserContent(continuationText);
    } else if (session.pendingToolResults.length > 0) {
      session.appendUserTurn({
        text: continuationText,
        toolResults: session.pendingToolResults,
      });
      session.replacePendingToolResults([]);
    } else {
      session.appendUserTurn({ text: continuationText });
    }
  }

  private warn(message: string): void {
    this.eventPorts.renderer({ type: "workflow-warning", message });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
