import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { CommandBus, PresentationCommand } from "@shared/commands";
import type { AgentRunResult } from "@shared/ipc";
import type { PresentationOutline } from "@shared/ipc";
import type { AgentEditorContext } from "@shared/ipc";
import type { AgentConversationMessage } from "@shared/session-recovery";
import { CommitGate, type CommitGateResult } from "./gate/commit-gate";
import { AgentRuntime } from "./runtime/agent-runtime";
import { outlineToRequest } from "./outline-planner";

export type AgentServiceEvent =
  | { type: "request-status"; message: string; progress: number }
  | { type: "workflow-progress"; message: string; progress: number }
  | { type: "text-chunk"; chunk: string };

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
  ) {}

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
  ): Promise<AgentRunResult> {
    const threadId = crypto.randomUUID();
    return this.run(threadId, request, model, executionStrategy, messageHistory, listener, editorContext, "any");
  }

  async continueAgentRun(
    threadId: string,
    request: string,
    listener?: AgentServiceEventListener,
    editorContext?: AgentEditorContext,
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
  ): Promise<AgentRunResult> {
    listener?.({ type: "request-status", message: "正在处理您的请求...", progress: 10 });
    const before = this.commandBus.getSnapshot();
    const runtimeResult = await this.runtime.run({
      threadId,
      request,
      presentationSnapshot: before,
      currentSlideId: editorContext?.currentSlideId,
      selectedElementIds: editorContext?.selectedElementIds ?? [],
      model,
      messageHistory,
      requiredOutcome,
      ...(listener && {
        onStreamChunk: (chunk: string) => {
          listener({ type: "text-chunk", chunk });
        },
      }),
    });

    if (runtimeResult.type === "message") {
      this.conversations.delete(threadId);
      // 流式内容已经通过 onStreamChunk 实时发送，这里不再发送
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
    listener?.({ type: "workflow-progress", message: "修改方案等待确认。", progress: 100 });
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
    const pending = this.pendingApprovals.get(threadId);
    if (!pending) throw new Error("Approval request not found or already completed.");

    if (!approved) {
      this.pendingApprovals.delete(threadId);
      this.runtime.clearSession(threadId);
      this.conversations.delete(threadId);
      return { status: "rejected", presentation: this.commandBus.getSnapshot() };
    }

    const current = this.commandBus.getSnapshot();
    if (current.revision !== pending.baseRevision) {
      this.pendingApprovals.delete(threadId);
      this.runtime.clearSession(threadId);
      throw new Error("The presentation changed after preview. Generate a new proposal before applying.");
    }
    const gate = await this.commitGate.evaluate(current, pending.commands, pending.modelRisk);
    if (!gate.success) {
      this.pendingApprovals.delete(threadId);
      this.runtime.clearSession(threadId);
      throw new Error(`Commit Gate rejected approved proposal: ${gate.errors.join("; ")}`);
    }

    this.commandBus.executeMany(pending.commands);
    this.pendingApprovals.delete(threadId);
    this.runtime.clearSession(threadId);
    this.conversations.delete(threadId);
    return { status: "completed", presentation: this.commandBus.getSnapshot() };
  }
}

export { AgentService as RefactoredAgentService };
