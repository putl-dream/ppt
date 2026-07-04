import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import type { CommandBus, PresentationCommand } from "@shared/commands";
import type { AgentEditorContext, AgentRunResult } from "@shared/ipc";
import type { AgentConversationMessage } from "@shared/session-recovery";
import { CommitGate, type CommitGateResult } from "./gate/commit-gate";
import { AgentRuntime } from "./runtime/agent-runtime";
import { formatRecoverableAgentError } from "./gateway/errors";
import type { ToolApprovalHandler } from "./runtime/permission-check";
import type { ToolApprovalBroker } from "./runtime/tool-approval-broker";

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

type PendingApproval = {
  commands: PresentationCommand[];
  summary: string;
  assumptions?: string[];
  modelRisk: "low" | "medium" | "high";
  baseRevision: number;
  gate: CommitGateResult;
};

type ContinuedConversation = {
  messages: AgentConversationMessage[];
  model?: AgentModelSelection;
  executionStrategy: AgentExecutionStrategy;
};

/** Coordinates Runtime, Commit Gate, approval persistence and CommandBus writes. */
export class AgentService {
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly conversations = new Map<string, ContinuedConversation>();

  constructor(
    private readonly commandBus: CommandBus,
    private readonly runtime: AgentRuntime,
    private readonly commitGate: CommitGate,
    private readonly workspaceRoot?: string,
    private readonly toolApprovalBroker?: ToolApprovalBroker,
  ) {}

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
  ): Promise<AgentRunResult> {
    const threadId = crypto.randomUUID();
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
  ): Promise<AgentRunResult> {
    const conversation = this.conversations.get(threadId);
    if (!conversation) throw new Error("Agent conversation not found or already completed.");
    conversation.messages.push({ role: "user", content: request });
    return this.run(
      threadId,
      request,
      conversation.model,
      conversation.executionStrategy,
      conversation.messages,
      listener,
      editorContext,
      "any",
      true,
      signal,
      runId,
      agentStepLimits,
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
  ): Promise<AgentRunResult> {
    if (signal?.aborted) {
      return {
        status: "chat",
        message: "会话已中断。",
        ...(this.conversations.has(threadId) ? { threadId } : {}),
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
        messageHistory,
        requiredOutcome,
        signal,
        workspaceRoot: this.workspaceRoot,
        agentStepLimits,
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
        return {
          status: "chat",
          message: recoveryMessage,
          ...(this.conversations.has(threadId) ? { threadId } : {}),
        };
      }
      throw error;
    }

    if (runtimeResult.type === "message") {
      this.conversations.delete(threadId);
      return { status: "chat", message: runtimeResult.content };
    }

    if (runtimeResult.type === "ask_user") {
      this.conversations.set(threadId, {
        messages: [
          ...messageHistory,
          ...(requestAlreadyInHistory ? [] : [{ role: "user" as const, content: request }]),
          { role: "assistant", content: runtimeResult.message },
        ],
        model,
        executionStrategy,
      });
      return {
        status: "chat",
        message: runtimeResult.message,
        threadId,
      };
    }

    listener?.({ type: "workflow-progress", message: "正在进行安全校验...", progress: 70 });
    const gate = await this.commitGate.evaluate(before, runtimeResult.commands, runtimeResult.risk);
    if (!gate.success || !gate.preview) {
      throw new Error(`Commit Gate rejected proposal: ${gate.errors.join("; ")}`);
    }

    const canAutoApply = executionStrategy === "AUTO" && gate.decision === "AUTO";
    if (canAutoApply) {
      this.commandBus.executeMany(runtimeResult.commands);
      this.runtime.clearSession(threadId);
      this.conversations.delete(threadId);
      listener?.({ type: "workflow-progress", message: "修改已完成。", progress: 100 });
      return { status: "completed", presentation: this.commandBus.getSnapshot() };
    }

    this.pendingApprovals.set(threadId, {
      commands: structuredClone(runtimeResult.commands),
      summary: runtimeResult.summary,
      assumptions: runtimeResult.assumptions ? [...runtimeResult.assumptions] : undefined,
      modelRisk: runtimeResult.risk,
      baseRevision: before.revision,
      gate,
    });
    this.conversations.delete(threadId);
    listener?.({ type: "approval-waiting", message: "修改方案等待确认。" });
    return {
      status: "approval-required",
      approval: {
        threadId,
        summary: runtimeResult.summary,
        commands: runtimeResult.commands,
        risk: gate.risk,
        assumptions: runtimeResult.assumptions,
        diff: gate.diff,
        preview: gate.preview,
      },
    };
  }

  async resume(threadId: string, approved: boolean): Promise<AgentRunResult> {
    const pendingApproval = this.pendingApprovals.get(threadId);
    if (!pendingApproval) {
      throw new Error("Approval request not found or already completed.");
    }

    if (!approved) {
      this.pendingApprovals.delete(threadId);
      this.runtime.clearSession(threadId);
      this.conversations.delete(threadId);
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
