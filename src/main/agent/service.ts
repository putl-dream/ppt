import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { CommandBus, PresentationCommand } from "@shared/commands";
import type { AgentEditorContext, AgentRunResult, ArtifactDiff } from "@shared/ipc";
import type { DeckAgentContext } from "@shared/deck-agent-context";
import type { ProjectArtifact } from "@shared/session";
import type { AgentConversationMessage } from "@shared/session-recovery";
import { CommitGate, type CommitGateResult } from "./gate/commit-gate";
import { AgentRuntime } from "./runtime/agent-runtime";

export type AgentServiceEvent =
  | { type: "request-status"; message: string; progress: number }
  | { type: "workflow-progress"; message: string; progress: number }
  | { type: "text-chunk"; chunk: string; source?: "message" | "tool-summary" }
  | { type: "thinking-chunk"; chunk: string; modelStep?: number }
  | { type: "stage-started"; message: string; stage: string }
  | { type: "artifact-read"; message: string; path: string }
  | { type: "artifact-diff-ready"; message: string; path: string }
  | { type: "tool-started"; message: string; toolName: string }
  | { type: "tool-finished"; message: string; toolName: string }
  | { type: "tool-validation-failed"; message: string; toolName: string; error: string }
  | { type: "approval-waiting"; message: string };

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
export type PendingPatch = {
  targetPath: string;
  summary: string;
  before: string;
  after: string;
  risk?: "low" | "medium" | "high";
};

/** Coordinates Runtime, Commit Gate, approval persistence and CommandBus writes. */
export class AgentService {
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly pendingPatches = new Map<string, PendingPatch>();
  private readonly conversations = new Map<string, ContinuedConversation>();

  constructor(
    private readonly commandBus: CommandBus,
    private readonly runtime: AgentRuntime,
    private readonly commitGate: CommitGate,
    private readonly sessionId?: string,
    private readonly fileStore?: {
      readProjectArtifact(sessionId: string, artifactIdOrPath: string): Promise<{ content?: string }>;
      writeProjectArtifact(sessionId: string, relativePath: string, content: string): Promise<{ changed: boolean; staleArtifactIds: string[]; changedArtifactId?: string }>;
      getProjectArtifactDiff(sessionId: string, relativePath: string, nextContent: string): Promise<ArtifactDiff>;
    },
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
    deckAgentContext?: DeckAgentContext,
  ): Promise<AgentRunResult> {
    const threadId = crypto.randomUUID();
    return this.run(threadId, request, model, executionStrategy, messageHistory, listener, editorContext, "any", false, signal, deckAgentContext);
  }

  async continueAgentRun(
    threadId: string,
    request: string,
    listener?: AgentServiceEventListener,
    editorContext?: AgentEditorContext,
    signal?: AbortSignal,
    deckAgentContext?: DeckAgentContext,
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
      deckAgentContext,
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
    deckAgentContext?: DeckAgentContext,
  ): Promise<AgentRunResult> {
    if (signal?.aborted) {
      throw new Error("Run aborted by user.");
    }
    listener?.({
      type: "stage-started",
      message: `开始处理您的请求...`,
      stage: requiredOutcome,
    });
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
      signal,
      deckAgentContext,
      onProgress: (ev) => {
        listener?.(ev as any);
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

    if (runtimeResult.type === "artifact_patch") {
      if (!this.fileStore || !this.sessionId) {
        throw new Error("File store or session ID is not configured for project artifact operations.");
      }

      listener?.({
        type: "artifact-read",
        message: `读取文件: ${runtimeResult.targetPath}`,
        path: runtimeResult.targetPath,
      });
      const beforeResult = await this.fileStore.readProjectArtifact(this.sessionId, runtimeResult.targetPath);
      const beforeContent = beforeResult.content ?? "";

      listener?.({
        type: "artifact-diff-ready",
        message: `对比文件差异: ${runtimeResult.targetPath}`,
        path: runtimeResult.targetPath,
      });
      const diffResult = await this.fileStore.getProjectArtifactDiff(
        this.sessionId,
        runtimeResult.targetPath,
        runtimeResult.patch,
      );

      this.pendingPatches.set(threadId, {
        targetPath: runtimeResult.targetPath,
        summary: runtimeResult.summary,
        before: beforeContent,
        after: runtimeResult.patch,
        risk: runtimeResult.risk,
      });

      this.conversations.delete(threadId);
      listener?.({ type: "approval-waiting", message: "内容修改方案等待确认。" });

      return {
        status: "artifact-patch-required",
        patch: {
          threadId,
          targetPath: runtimeResult.targetPath,
          summary: runtimeResult.summary,
          before: beforeContent,
          after: runtimeResult.patch,
          diff: diffResult,
          risk: runtimeResult.risk,
          staleArtifactIds: [],
        },
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
    if (pendingApproval) {
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

    const pendingPatch = this.pendingPatches.get(threadId);
    if (pendingPatch) {
      this.pendingPatches.delete(threadId);
      this.runtime.clearSession(threadId);
      this.conversations.delete(threadId);

      if (!approved) {
        return { status: "rejected", presentation: this.commandBus.getSnapshot() };
      }

      if (!this.fileStore || !this.sessionId) {
        throw new Error("File store or session ID is not configured for project artifact operations.");
      }

      const writeResult = await this.fileStore.writeProjectArtifact(
        this.sessionId,
        pendingPatch.targetPath,
        pendingPatch.after,
      );

      return {
        status: "artifact-updated",
        write: {
          path: pendingPatch.targetPath,
          changed: writeResult.changed,
          changedArtifactId: writeResult.changedArtifactId,
          staleArtifactIds: writeResult.staleArtifactIds,
        },
      };
    }

    throw new Error("Approval request or pending patch not found or already completed.");
  }
}
