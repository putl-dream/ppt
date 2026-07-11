import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import type { CommandBus, PresentationCommand } from "@shared/commands";
import type { AgentEditorContext, AgentRunResult } from "@shared/ipc";
import type { AgentConversationMessage } from "@shared/session-recovery";
import type { LayoutChoice } from "@shared/layout-preference";
import { CommitGate, type CommitGateResult } from "./gate/commit-gate";
import { AgentRuntime } from "./runtime/agent-runtime";
import { formatRecoverableAgentError } from "./gateway/errors";
import type { ToolApprovalHandler } from "./runtime/permission-check";
import type { ToolApprovalBroker } from "./runtime/tool-approval-broker";
import type { MessageBus } from "./teammate/message-bus";
import type { TeammateManager } from "./teammate/spawn-teammate";
import {
  DurableServiceStore,
  type DurablePendingApproval,
  type DurableServiceThread,
} from "./persistence/durable-service-store";
import type { ConversationDatabase } from "../conversation-database";

export type AgentServiceEvent =
  | { type: "request-status"; message: string; progress: number }
  | { type: "workflow-progress"; message: string; progress: number }
  | { type: "text-chunk"; chunk: string; source?: "message" | "tool-summary" }
  | { type: "thinking-chunk"; chunk: string; modelStep?: number }
  | { type: "stage-started"; message: string; stage: string }
  | { type: "tool-started"; message: string; toolName: string }
  | { type: "tool-finished"; message: string; toolName: string }
  | { type: "tool-validation-failed"; message: string; toolName: string; error: string }
  | { type: "approval-waiting"; message: string }
  | {
      type: "tool-approval-waiting";
      message: string;
      approvalId: string;
      toolName: string;
      reason: string;
      detail: string;
    }
  | {
      type: "task-graph-updated";
      message: string;
      tasks: AgentTaskNode[];
      goal?: string | null;
    }
  | { type: "subagent-started"; taskId: string; description: string }
  | { type: "subagent-thinking-chunk"; taskId: string; chunk: string }
  | { type: "subagent-tool-started"; taskId: string; toolName: string; message: string }
  | { type: "subagent-tool-finished"; taskId: string; toolName: string; message: string }
  | { type: "subagent-finished"; taskId: string };

export type AgentServiceEventListener = (event: AgentServiceEvent) => void;

type PendingApproval = DurablePendingApproval;

type ContinuedConversation = {
  messages: AgentConversationMessage[];
  model?: AgentModelSelection;
  executionStrategy: AgentExecutionStrategy;
};

/** Coordinates Runtime, Commit Gate, approval persistence and CommandBus writes. */
export class AgentService {
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly conversations = new Map<string, ContinuedConversation>();
  private readonly durableStore?: DurableServiceStore;

  constructor(
    private readonly commandBus: CommandBus,
    private readonly runtime: AgentRuntime,
    private readonly commitGate: CommitGate,
    private readonly workspaceRoot?: string,
    private readonly toolApprovalBroker?: ToolApprovalBroker,
    private readonly messageBus?: MessageBus,
    private readonly teammateManager?: TeammateManager,
    conversationDatabase?: ConversationDatabase,
    private readonly runtimeRoot?: string,
  ) {
    this.durableStore = conversationDatabase
      ? new DurableServiceStore(conversationDatabase)
      : workspaceRoot
        ? new DurableServiceStore(workspaceRoot)
        : undefined;
  }

  hasActiveConversation(threadId: string): boolean {
    return this.conversations.has(threadId);
  }

  restoreAgentRunConversation(
    threadId: string,
    messages: AgentConversationMessage[],
    model?: AgentModelSelection,
    executionStrategy: AgentExecutionStrategy = "REQUEST_APPROVAL",
  ): void {
    this.conversations.set(threadId, {
      messages: structuredClone(messages),
      model,
      executionStrategy,
    });
  }

  async restoreDurableThread(threadId: string): Promise<boolean> {
    const state = await this.durableStore?.load(threadId);
    if (!state) return false;
    if (state.status === "waiting_approval" && state.pendingApproval) {
      this.pendingApprovals.set(threadId, structuredClone(state.pendingApproval));
      return true;
    }
    if (state.status === "active" || state.status === "waiting_user") {
      this.conversations.set(threadId, {
        messages: structuredClone(state.messages),
        model: state.model,
        executionStrategy: state.executionStrategy,
      });
      return true;
    }
    return false;
  }

  private async persistThread(
    threadId: string,
    state: Omit<DurableServiceThread, "version" | "threadId" | "updatedAt">,
  ): Promise<void> {
    await this.durableStore?.save({
      version: 1,
      threadId,
      ...state,
      updatedAt: new Date().toISOString(),
    });
  }

  async start(
    request: string,
    model?: AgentModelSelection,
    executionStrategy: AgentExecutionStrategy = "REQUEST_APPROVAL",
    listener?: AgentServiceEventListener,
    editorContext?: AgentEditorContext,
    messageHistory: AgentConversationMessage[] = [],
    signal?: AbortSignal,
    runId?: string,
    agentStepLimits?: AgentStepLimits,
    layoutChoice?: LayoutChoice,
  ): Promise<AgentRunResult> {
    // A caller-provided run id is stable across renderer/main persistence and
    // doubles as the recoverable thread id for an interrupted first turn.
    const threadId = runId ?? crypto.randomUUID();
    this.conversations.set(threadId, {
      messages: [
        ...structuredClone(messageHistory),
        { role: "user", content: request },
      ],
      model,
      executionStrategy,
    });
    await this.persistThread(threadId, {
      status: "active",
      messages: structuredClone(this.conversations.get(threadId)!.messages),
      model,
      executionStrategy,
    });
    return this.run(
      threadId,
      request,
      model,
      executionStrategy,
      messageHistory,
      listener,
      editorContext,
      "any",
      false,
      signal,
      runId,
      agentStepLimits,
      layoutChoice,
    );
  }

  async continueAgentRun(
    threadId: string,
    request: string,
    listener?: AgentServiceEventListener,
    editorContext?: AgentEditorContext,
    signal?: AbortSignal,
    runId?: string,
    agentStepLimits?: AgentStepLimits,
    layoutChoice?: LayoutChoice,
    modelOverride?: AgentModelSelection,
  ): Promise<AgentRunResult> {
    const conversation = this.conversations.get(threadId);
    if (!conversation) throw new Error("Agent conversation not found or already completed.");
    const model = modelOverride ?? conversation.model;
    if (modelOverride) conversation.model = modelOverride;
    conversation.messages.push({ role: "user", content: request });
    await this.persistThread(threadId, {
      status: "active",
      messages: structuredClone(conversation.messages),
      model,
      executionStrategy: conversation.executionStrategy,
    });
    return this.run(
      threadId,
      request,
      model,
      conversation.executionStrategy,
      conversation.messages,
      listener,
      editorContext,
      "any",
      true,
      signal,
      runId,
      agentStepLimits,
      layoutChoice,
    );
  }

  private async run(
    threadId: string,
    request: string,
    model: AgentModelSelection | undefined,
    executionStrategy: AgentExecutionStrategy,
    messageHistory: AgentConversationMessage[],
    listener?: AgentServiceEventListener,
    editorContext?: AgentEditorContext,
    requiredOutcome: "any" | "command_proposal" = "any",
    requestAlreadyInHistory = false,
    signal?: AbortSignal,
    runId?: string,
    agentStepLimits?: AgentStepLimits,
    layoutChoice?: LayoutChoice,
  ): Promise<AgentRunResult> {
    if (signal?.aborted) {
      this.conversations.delete(threadId);
      this.runtime.clearSession(threadId);
      await this.persistThread(threadId, {
        status: "interrupted",
        messages: structuredClone(messageHistory),
        model,
        executionStrategy,
      });
      return {
        status: "chat",
        message: "会话已中断。",
      };
    }
    listener?.({
      type: "stage-started",
      message: "开始处理您的请求...",
      stage: requiredOutcome,
    });
    const before = this.commandBus.getSnapshot();
    let runtimeResult;
    try {
      runtimeResult = await this.runtime.run({
        threadId,
        request,
        presentationSnapshot: before,
        currentSlideId: editorContext?.currentSlideId,
        selectedElementIds: editorContext?.selectedElementIds ?? [],
        model,
        executionStrategy,
        runId,
        resumeThread: requestAlreadyInHistory,
        messageHistory,
        requiredOutcome,
        layoutChoice,
        signal,
        workspaceRoot: this.workspaceRoot,
        runtimeRoot: this.runtimeRoot,
        agentStepLimits,
        messageBus: this.messageBus,
        teammateManager: this.teammateManager,
        requestToolApproval: this.resolveToolApprovalHandler(executionStrategy, runId, listener),
        onProgress: (ev) => {
          listener?.(ev as AgentServiceEvent);
        },
        ...(listener && {
          onStreamChunk: (chunk: string, source: "message" | "tool-summary") => {
            listener({ type: "text-chunk", chunk, source });
          },
          onThinkingChunk: (chunk: string, modelStep: number) => {
            listener({ type: "thinking-chunk", chunk, modelStep });
          },
        }),
      });
    } catch (error) {
      const recoveryMessage = formatRecoverableAgentError(error, signal);
      if (recoveryMessage) {
        if (signal?.aborted) {
          this.runtime.clearSession(threadId);
          this.conversations.delete(threadId);
          await this.persistThread(threadId, {
            status: "interrupted",
            messages: structuredClone(messageHistory),
            model,
            executionStrategy,
          });
          return { status: "chat", message: recoveryMessage };
        }
        if (!this.conversations.has(threadId)) {
          this.runtime.clearSession(threadId);
        }
        return {
          status: "chat",
          message: recoveryMessage,
          ...(this.conversations.has(threadId) ? { threadId } : {}),
        };
      }
      if (!this.conversations.has(threadId)) {
        this.runtime.clearSession(threadId);
      }
      throw error;
    }

    if (runtimeResult.type === "message") {
      this.runtime.clearSession(threadId);
      this.conversations.delete(threadId);
      await this.persistThread(threadId, {
        status: "completed",
        messages: [
          ...structuredClone(messageHistory),
          ...(requestAlreadyInHistory ? [] : [{ role: "user" as const, content: request }]),
          { role: "assistant", content: runtimeResult.content },
        ],
        model,
        executionStrategy,
      });
      return { status: "chat", message: runtimeResult.content };
    }

    if (runtimeResult.type === "ask_user") {
      this.conversations.set(threadId, {
        messages: [
          ...messageHistory,
          ...(requestAlreadyInHistory ? [] : [{ role: "user" as const, content: request }]),
          { role: "assistant", content: runtimeResult.content },
        ],
        model,
        executionStrategy,
      });
      await this.persistThread(threadId, {
        status: "waiting_user",
        messages: structuredClone(this.conversations.get(threadId)!.messages),
        model,
        executionStrategy,
      });
      return {
        status: "chat",
        message: runtimeResult.content,
        threadId,
        question: runtimeResult.question,
      };
    }

    if (runtimeResult.type !== "command_proposal") {
      throw new Error(`Unexpected agent runtime result: ${runtimeResult.type}`);
    }

    listener?.({ type: "workflow-progress", message: "正在进行安全校验...", progress: 70 });
    const proposal = runtimeResult;
    const gate = await this.commitGate.evaluate(before, proposal.commands, proposal.risk);
    if (!gate.success || !gate.preview) {
      throw new Error(`Commit Gate rejected proposal: ${gate.errors.join("; ")}`);
    }

    const canAutoApply = executionStrategy === "AUTO" && gate.decision === "AUTO";
    if (canAutoApply) {
      this.commandBus.executeMany(proposal.commands);
      this.runtime.clearSession(threadId);
      this.conversations.delete(threadId);
      listener?.({ type: "workflow-progress", message: "修改已完成。", progress: 100 });
      return { status: "completed", presentation: this.commandBus.getSnapshot() };
    }

    this.pendingApprovals.set(threadId, {
      commands: structuredClone(proposal.commands),
      summary: proposal.summary,
      assumptions: proposal.assumptions ? [...proposal.assumptions] : undefined,
      modelRisk: proposal.risk,
      baseRevision: before.revision,
      gate,
    });
    await this.persistThread(threadId, {
      status: "waiting_approval",
      messages: [
        ...structuredClone(messageHistory),
        ...(requestAlreadyInHistory ? [] : [{ role: "user" as const, content: request }]),
        { role: "assistant", content: proposal.summary },
      ],
      model,
      executionStrategy,
      pendingApproval: structuredClone(this.pendingApprovals.get(threadId)!),
    });
    this.runtime.clearSession(threadId);
    this.conversations.delete(threadId);
    listener?.({ type: "approval-waiting", message: "修改方案等待确认。" });
    return {
      status: "approval-required",
      approval: {
        threadId,
        summary: proposal.summary,
        commands: proposal.commands,
        risk: gate.risk,
        assumptions: proposal.assumptions,
        diff: gate.diff,
        preview: gate.preview,
      },
    };
  }

  async resume(threadId: string, approved: boolean): Promise<AgentRunResult> {
    const durableState = await this.durableStore?.load(threadId);
    if (!this.pendingApprovals.has(threadId)) {
      await this.restoreDurableThread(threadId);
    }
    const pendingApproval = this.pendingApprovals.get(threadId);
    if (!pendingApproval) {
      throw new Error("Approval request not found or already completed.");
    }

    if (!approved) {
      this.pendingApprovals.delete(threadId);
      this.runtime.clearSession(threadId);
      this.conversations.delete(threadId);
      await this.persistThread(threadId, {
        status: "rejected",
        messages: durableState?.messages ?? [],
        model: durableState?.model,
        executionStrategy: durableState?.executionStrategy ?? "REQUEST_APPROVAL",
      });
      return { status: "rejected", presentation: this.commandBus.getSnapshot() };
    }

    const current = this.commandBus.getSnapshot();
    if (current.revision !== pendingApproval.baseRevision) {
      this.pendingApprovals.delete(threadId);
      this.runtime.clearSession(threadId);
      throw new Error("The presentation changed after preview. Generate a new proposal before applying.");
    }
    const gate = await this.commitGate.evaluate(current, pendingApproval.commands, pendingApproval.modelRisk);
    if (!gate.success) {
      this.pendingApprovals.delete(threadId);
      this.runtime.clearSession(threadId);
      throw new Error(`Commit Gate rejected approved proposal: ${gate.errors.join("; ")}`);
    }

    this.commandBus.executeMany(pendingApproval.commands);
    this.pendingApprovals.delete(threadId);
    this.runtime.clearSession(threadId);
    this.conversations.delete(threadId);
    await this.persistThread(threadId, {
      status: "completed",
      messages: durableState?.messages ?? [],
      model: durableState?.model,
      executionStrategy: durableState?.executionStrategy ?? "REQUEST_APPROVAL",
    });
    return { status: "completed", presentation: this.commandBus.getSnapshot() };
  }

  private resolveToolApprovalHandler(
    executionStrategy: AgentExecutionStrategy,
    runId: string | undefined,
    listener: AgentServiceEventListener | undefined,
  ): ToolApprovalHandler | undefined {
    if (executionStrategy === "AUTO") {
      return async () => true;
    }
    if (runId && listener && this.toolApprovalBroker) {
      return this.toolApprovalBroker.createHandler(runId, listener);
    }
    return undefined;
  }
}
