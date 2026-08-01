import { join } from "node:path";
import type { BrowserWindow, WebContents } from "electron";
import { CommandBus } from "@shared/commands";
import { agentRunRequestSchema, type AgentRunResult, type AgentStreamEvent } from "@shared/ipc";
import type { SessionSnapshot } from "@shared/session";
import type { ConversationEventKind } from "@shared/conversation-events";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import { isTeammateProgressEvent } from "@shared/teammate-progress";
import {
  asPresentationId,
  asProjectId,
  type ProjectId,
  type PptJobState,
} from "@shared/presentation-lifecycle";
import { AgentService, type AgentServiceEvent } from "./agent/service";
import { AgentRuntime } from "./agent/runtime/agent-runtime";
import { createDefaultToolRegistry } from "./agent/tools/tool-registry";
import { MessageBus } from "./agent/teammate/message-bus";
import { TeammateManager } from "./agent/teammate/spawn-teammate";
import { CommitGate } from "./agent/gate/commit-gate";
import { RiskPolicy } from "./agent/gate/risk-policy";
import {
  createModuleLogger,
  diagnosticValuePreview,
  requestSummary,
  withLogContext,
} from "./agent/logger";
import {
  toResultDisplayEvents,
  toStreamDisplayEvent,
} from "./agent/display/display-event-adapter";
import { isRuntimeCancellation } from "./agent/runtime/lifecycle/runtime-cancellation";
import {
  canonicalJson,
} from "./presentation-lifecycle/content-addressed-blob-store";
import { PresentationLifecycleToolBridge } from "./presentation-lifecycle/presentation-lifecycle-tool-bridge";
import { PresentationCommitService } from "./presentation-lifecycle/presentation-commit-service";
import type { AppContext } from "./app-context";

const logger = createModuleLogger("main");

export interface SessionRuntime {
  commandBus: CommandBus;
  presentationCommitService: PresentationCommitService;
  projectId: ProjectId;
  agentService: AgentService;
  messageBus?: MessageBus;
  teammateManager?: TeammateManager;
  workspaceRoot?: string;
  runtimeRoot: string;
}

/**
 * 为单个会话装配独立的编辑状态与 Agent 基础设施。
 * CommandBus 是该会话 Presentation 的内存事实源，其余服务共享同一实例。
 */
export function createSessionRuntime(
  ctx: AppContext,
  snapshot: SessionSnapshot,
): SessionRuntime {
  const commandBus = new CommandBus(snapshot.presentation);
  const registry = createDefaultToolRegistry();
  const runtimeRoot = join(ctx.applicationDataRoot, "runtime", snapshot.session.id);
  const projectStorageIdentity = snapshot.session.workspacePath
    ?? `session:${snapshot.session.id}`;
  const projectId = asProjectId(
    ctx.sessionStore.conversationDatabase.ensureProject(
      projectStorageIdentity,
      snapshot.presentation.title,
    ),
  );
  const messageBus = new MessageBus(MessageBus.defaultMailboxDir(runtimeRoot));
  const teammateManager = new TeammateManager(messageBus);
  const presentationCommitService = new PresentationCommitService(
    snapshot.session.id,
    projectId,
    asPresentationId(snapshot.presentation.id),
    commandBus,
    ctx.sessionStore,
    ctx.presentationLifecycleOrchestrator,
    ctx.lifecycleBlobStore,
  );
  const agentService = new AgentService(
    commandBus,
    new AgentRuntime(
      registry,
      ctx.agentGateway,
      ctx.skillRegistry,
      ctx.sessionStore.conversationDatabase,
      ({ queryId, options }) => {
        if (options.runId) {
          ctx.sessionStore.conversationDatabase.bindRunQueryId(
            options.runId,
            queryId,
          );
        }
        return new PresentationLifecycleToolBridge(
          ctx.presentationLifecycleOrchestrator,
          projectId,
          snapshot.presentation.id,
          queryId,
          options.request,
          ctx.lifecycleBlobStore,
          ctx.lifecycleArtifactChangeObserver,
          options.startMode.type === "resume_query",
        );
      },
    ),
    new CommitGate(new RiskPolicy()),
    snapshot.project?.rootPath,
    ctx.toolApprovalBroker,
    messageBus,
    teammateManager,
    ctx.sessionStore.conversationDatabase,
    runtimeRoot,
    ctx.presentationLifecycleOrchestrator,
    presentationCommitService,
    ctx.lifecycleBlobStore,
  );
  return {
    commandBus,
    presentationCommitService,
    projectId,
    agentService,
    messageBus,
    teammateManager,
    workspaceRoot: snapshot.project?.rootPath,
    runtimeRoot,
  };
}

export function createAgentStreamEmitter(
  ctx: AppContext,
  sender: WebContents,
  sessionId: string,
  runId: string,
  threadId: string,
  controller: AbortController,
): (streamEvent: AgentServiceEvent) => void {
  const abortRun = (reason: string) => {
    if (controller.signal.aborted) return;
    controller.abort();
    ctx.toolApprovalBroker.cancelForRun(runId);
    logger.info("agent.run.aborted", { runId, reason });
  };

  return (streamEvent: AgentServiceEvent) => withLogContext({ sessionId, runId, threadId }, () => {
    if (streamEvent.type === "teammate-tool-started") {
      logger.info("teammate.tool.started", {
        teammateName: streamEvent.teammateName,
        activityId: streamEvent.activityId,
        taskId: streamEvent.taskId,
        toolName: streamEvent.toolName,
      });
    } else if (streamEvent.type === "teammate-tool-finished") {
      logger[streamEvent.status === "failed" ? "warn" : "info"]("teammate.tool.finished", {
        teammateName: streamEvent.teammateName,
        activityId: streamEvent.activityId,
        taskId: streamEvent.taskId,
        toolName: streamEvent.toolName,
        status: streamEvent.status,
        message: streamEvent.message,
      });
    } else if (streamEvent.type === "tool-approval-waiting") {
      logger.info("agent.tool-approval.requested", {
        approvalId: streamEvent.approvalId,
        toolName: streamEvent.toolName,
        reason: streamEvent.reason,
      });
      logger.debug("agent.tool-approval.detail", {
        approvalId: streamEvent.approvalId,
        detail: diagnosticValuePreview(streamEvent.detail, 8 * 1024),
      });
    } else if (streamEvent.type === "tool-approval-resolved") {
      logger.info("agent.tool-approval.observed", {
        approvalId: streamEvent.approvalId,
        toolName: streamEvent.toolName,
        status: streamEvent.status,
      });
    }
    const eventKind: ConversationEventKind = (() => {
      switch (streamEvent.type) {
        case "thinking-chunk":
        case "teammate-thinking-chunk":
          return "reasoning_chunk";
        case "text-chunk": return "text_chunk";
        case "text-reset":
        case "text-commit":
          return "workflow_progress";
        case "stage-started": return "stage_started";
        case "workflow-progress":
        case "request-status":
        case "teammate-assignment-started":
        case "teammate-assignment-finished":
          return "workflow_progress";
        case "tool-state":
          return streamEvent.status === "running" ? "tool_started" : "tool_finished";
        case "teammate-tool-started":
          return "tool_started";
        case "teammate-tool-finished":
          return "tool_finished";
        case "approval-waiting":
        case "tool-approval-waiting":
          return "approval_requested";
        case "tool-approval-resolved":
          return "approval_resolved";
        case "task-list-updated": return "task_list_updated";
        default: return "workflow_progress";
      }
    })();
    ctx.sessionStore.conversationDatabase.appendEvent({
      sessionId,
      runId,
      threadId,
      kind: eventKind,
      payload: structuredClone(streamEvent) as unknown as Record<string, unknown>,
    });
    if (
      streamEvent.type === "task-list-updated"
      || isTeammateProgressEvent(streamEvent)
    ) {
      void ctx.sessionStore.refreshAgentRunTrace(sessionId, runId).catch((error) => {
        logger.warn("agent.run-trace.persist-failed", { sessionId, runId, error });
      });
    }
    if (sender.isDestroyed()) {
      abortRun("renderer-disposed");
      return;
    }
    try {
      sender.send("agent:stream", { ...streamEvent, runId, sessionId });
      const displayEvent = toStreamDisplayEvent(streamEvent, sessionId, runId);
      if (displayEvent) {
        sender.send("agent:stream", {
          type: "display-event",
          runId,
          sessionId,
          event: displayEvent,
        } satisfies AgentStreamEvent);
      }
    } catch (error) {
      logger.warn("agent.stream.send-failed", { runId, error });
      abortRun("stream-send-failed");
    }
  });
}

export interface SessionRuntimeRegistry {
  ensureRuntime(snapshot: SessionSnapshot): Promise<SessionRuntime>;
  getActiveRuntime(): Promise<SessionRuntime>;
  getRuntimeForSession(sessionId: string): Promise<SessionRuntime>;
  setActiveSessionId(sessionId: string): void;
  getActiveSessionId(): string;
  deleteRuntime(sessionId: string): void;
  ensureCurrentPresentationRevision(runtime: SessionRuntime): Promise<PptJobState>;
  finalizeAgentResult(
    sessionId: string,
    runtime: SessionRuntime,
    result: AgentRunResult,
    runId?: string,
  ): Promise<AgentRunResult>;
  runAgentOperation(
    operation: string,
    sessionId: string,
    runId: string | undefined,
    request: string | undefined,
    details: Record<string, unknown>,
    signal: AbortSignal | undefined,
    task: () => Promise<AgentRunResult>,
  ): Promise<AgentRunResult>;
  parseAgentRequest(operation: string, rawRequest: unknown): ReturnType<typeof agentRunRequestSchema.parse>;
  abortAllActiveRuns(reason: string): void;
  attachWindowLifecycle(window: BrowserWindow): void;
  activeRuns: Map<string, AbortController>;
  sessionActiveRuns: Map<string, string>;
  createStreamEmitter(
    sender: WebContents,
    sessionId: string,
    runId: string,
    threadId: string,
    controller: AbortController,
  ): (streamEvent: AgentServiceEvent) => void;
}

export function createSessionRuntimeRegistry(ctx: AppContext): SessionRuntimeRegistry {
  const runtimes = new Map<string, SessionRuntime>();
  const sessionActiveRuns = new Map<string, string>();
  const activeRuns = new Map<string, AbortController>();
  let activeSessionId = ctx.sessionStore.getBootstrap().activeSession?.session.id ?? "";

  const ensureRuntime = async (snapshot: SessionSnapshot): Promise<SessionRuntime> => {
    const existing = runtimes.get(snapshot.session.id);
    if (existing && existing.workspaceRoot === snapshot.project?.rootPath) return existing;
    const runtime = createSessionRuntime(ctx, snapshot);
    await runtime.teammateManager?.reconcileInterrupted();
    runtimes.set(snapshot.session.id, runtime);
    return runtime;
  };

  const getActiveRuntime = async (): Promise<SessionRuntime> => {
    if (!activeSessionId) {
      throw new Error("No active session.");
    }
    return ensureRuntime(ctx.sessionStore.getSession(activeSessionId));
  };

  const getRuntimeForSession = (sessionId: string): Promise<SessionRuntime> =>
    ensureRuntime(ctx.sessionStore.getSession(sessionId));

  const ensureCurrentPresentationRevision = async (
    runtime: SessionRuntime,
  ): Promise<PptJobState> => {
    const presentation = runtime.commandBus.getSnapshot();
    const presentationId = asPresentationId(presentation.id);
    const existing = ctx.presentationLifecycleOrchestrator.getState(presentationId);
    if (
      existing?.presentationRevisionId
      && existing.presentationRevisionNumber === presentation.revision
    ) {
      return existing;
    }
    const registration = ctx.presentationLifecycleOrchestrator.beginCapability({
      projectId: runtime.projectId,
      presentationId,
      capability: "edit",
      instruction: "Register the current authoritative Presentation revision.",
      basePresentationRevisionId: existing?.presentationRevisionId,
    });
    const presentationBlob = await ctx.lifecycleBlobStore.put(
      Buffer.from(canonicalJson(presentation), "utf8"),
      "application/vnd.agent-ppt.presentation+json",
    );
    return ctx.presentationLifecycleOrchestrator.completePresentation({
      jobId: registration.jobId,
      presentationBlob,
      presentationRevisionNumber: presentation.revision,
    });
  };

  /**
   * Presentation 已由 PresentationCommitService 原子提交；这里仅把领域
   * 结果转换为 Renderer 可回放的展示事件。
   */
  const finalizeAgentResult = async (
    sessionId: string,
    _runtime: SessionRuntime,
    result: AgentRunResult,
    runId?: string,
  ): Promise<AgentRunResult> => {
    const displayEvents = [
      ...(result.displayEvents ?? []),
      ...toResultDisplayEvents(result, sessionId, runId),
    ];
    return displayEvents.length > 0 ? { ...result, displayEvents } : result;
  };

  const abortAllActiveRuns = (reason: string) => {
    for (const [runId, controller] of activeRuns) {
      if (controller.signal.aborted) continue;
      controller.abort();
      ctx.toolApprovalBroker.cancelForRun(runId);
      logger.info("agent.run.aborted", { runId, reason });
    }
  };

  const attachWindowLifecycle = (window: BrowserWindow) => {
    window.webContents.on("render-process-gone", (_event, details) => {
      logger.error("renderer.process.gone", {
        webContentsId: window.webContents.id,
        ...details,
      });
      abortAllActiveRuns(`render-process-gone:${details.reason}`);
    });
    window.on("closed", () => {
      abortAllActiveRuns("window-closed");
    });
  };

  const runAgentOperation = async (
    operation: string,
    sessionId: string,
    runId: string | undefined,
    request: string | undefined,
    details: Record<string, unknown>,
    signal: AbortSignal | undefined,
    task: () => Promise<AgentRunResult>,
  ): Promise<AgentRunResult> => {
    const threadId = typeof details.threadId === "string" ? details.threadId : runId;
    return withLogContext({ operation, sessionId, runId, threadId }, async () => {
      const startedAt = Date.now();
      let taskOutcome: "completed" | "failed" | "interrupted" = "completed";
      if (request !== undefined) {
        logger.info("agent.request.received", requestSummary(request));
        logger.debug("agent.request.detail", {
          request: diagnosticValuePreview(request, 8 * 1024),
        });
      }
      logger.info("session.operation.started", details);
      try {
        const result = await task();
        taskOutcome = result.status === "interrupted"
          ? "interrupted"
          : result.status === "failed"
            ? "failed"
            : "completed";
        if (runId) {
          ctx.sessionStore.conversationDatabase.finishRun({
            runId,
            status: result.status === "interrupted"
              ? "interrupted"
              : result.status === "failed"
                ? "failed"
                : "completed",
            result,
            ...(result.status === "failed" ? { error: result.error } : {}),
            threadId: "threadId" in result && typeof result.threadId === "string"
              ? result.threadId
              : runId,
          });
          await ctx.sessionStore.finalizeAgentRunMessage(sessionId, runId, result);
        }
        logger.info("session.operation.completed", {
          status: result.status,
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const interrupted = isRuntimeCancellation(error, signal);
        taskOutcome = interrupted ? "interrupted" : "failed";
        const failureThreadId = typeof details.threadId === "string"
          ? details.threadId
          : runId;
        const result: AgentRunResult = interrupted
          ? {
              status: "interrupted",
              ...(failureThreadId ? { threadId: failureThreadId } : {}),
            }
          : {
              status: "failed",
              error: formatPublicErrorMessage(
                error,
                "处理请求时遇到问题，请稍后重试。",
              ),
              ...(failureThreadId ? { threadId: failureThreadId } : {}),
            };
        if (runId) {
          ctx.sessionStore.conversationDatabase.finishRun({
            runId,
            status: interrupted ? "interrupted" : "failed",
            error: message,
            result,
          });
          await ctx.sessionStore.finalizeAgentRunMessage(sessionId, runId, result);
        }
        logger.error("session.operation.failed", {
          durationMs: Date.now() - startedAt,
          error,
        });
        if (runId) return result;
        throw error;
      } finally {
        await ctx.tokenUsageStore.recordTask(
          Date.now() - startedAt,
          new Date(),
          taskOutcome,
        ).catch((error) => {
          logger.error("session.operation.usage-persist-failed", { error });
        });
      }
    });
  };

  const parseAgentRequest = (operation: string, rawRequest: unknown) => {
    try {
      return agentRunRequestSchema.parse(rawRequest);
    } catch (error) {
      logger.warn("agent.request.invalid", { operation, error });
      throw error;
    }
  };

  return {
    ensureRuntime,
    getActiveRuntime,
    getRuntimeForSession,
    setActiveSessionId: (sessionId: string) => {
      activeSessionId = sessionId;
    },
    getActiveSessionId: () => activeSessionId,
    deleteRuntime: (sessionId: string) => {
      runtimes.delete(sessionId);
    },
    ensureCurrentPresentationRevision,
    finalizeAgentResult,
    runAgentOperation,
    parseAgentRequest,
    abortAllActiveRuns,
    attachWindowLifecycle,
    activeRuns,
    sessionActiveRuns,
    createStreamEmitter: (sender, sessionId, runId, threadId, controller) =>
      createAgentStreamEmitter(ctx, sender, sessionId, runId, threadId, controller),
  };
}
