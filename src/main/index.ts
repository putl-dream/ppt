import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, dialog, type MessageBoxOptions } from "electron";
import { CommandBus, type PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import {
  agentRunRequestSchema,
  type AgentRunRequest,
  type ResolvedAgentRunRequest,
  type AgentRunResult,
  type AgentStreamEvent,
  type CreateSessionOptions,
  type ExportPresentationOptions,
} from "@shared/ipc";
import { deckExportService } from "./deck/deck-export-service";
import {
  continueDeckBatchAfterApproval,
  deckGenerationJobRunner,
  type DeckGenerationStreamEvent,
} from "./deck/deck-generation-job-runner";
import { deckGenerationService } from "./deck/deck-generation-service";
import { AgentService, type AgentServiceEvent } from "./agent/service";
import {
  agentExecutionStrategySchema,
  agentModelSettingsSchema,
  type AgentExecutionStrategy,
  type AgentModelSettings,
} from "@shared/agent";
import { AgentGateway } from "./agent/gateway";
import { AgentRuntime } from "./agent/runtime/agent-runtime";
import { createDefaultToolRegistry } from "./agent/tools/tool-registry";
import { CommitGate } from "./agent/gate/commit-gate";
import { RiskPolicy } from "./agent/gate/risk-policy";
import { createModuleLogger, requestSummary } from "./agent/logger";
import { FileSessionStore } from "./session-store";
import type { SessionChatMessage, SessionSnapshot } from "@shared/session";
import { projectArtifactStatusSchema } from "@shared/session";
import { isProjectStageId, primaryProjectArtifactPaths, projectStageIds } from "@shared/project";
import {
  buildAgentRunPlan,
  type ArtifactContentMap,
} from "@shared/agent-run-plan";
import { mergeEditorContext } from "@shared/deck-agent-context";
import {
  findRecoverableConversation,
  toAgentMessageHistory,
} from "@shared/session-recovery";
import type { DeckBatchPlan } from "./deck/deck-batch-planner";
import {
  buildDeckAgentStructuredPrompt,
  createArtifactReader,
  deckContextBuilder,
} from "./deck/deck-context-builder";

const logger = createModuleLogger("main");
const agentGateway = new AgentGateway();

interface SessionRuntime {
  commandBus: CommandBus;
  agentService: AgentService;
}

function createSessionRuntime(
  snapshot: SessionSnapshot,
): SessionRuntime {
  const commandBus = new CommandBus(snapshot.presentation);
  const registry = createDefaultToolRegistry();
  const agentService = new AgentService(
    commandBus,
    new AgentRuntime(registry, agentGateway),
    new CommitGate(new RiskPolicy()),
    snapshot.session.id,
    snapshot.project?.rootPath,
    sessionStore,
  );
  return {
    commandBus,
    agentService,
  };
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedUrl) => {
    console.error("Renderer failed to load", { errorCode, errorDescription, validatedUrl });
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

const ARTIFACT_CONTEXT_CHAR_LIMIT = 8_000;

function resolvePrimaryArtifactPath(artifactIdOrPath: string): string {
  return isProjectStageId(artifactIdOrPath)
    ? primaryProjectArtifactPaths[artifactIdOrPath]
    : artifactIdOrPath;
}

function truncateArtifactContent(content: string): string {
  if (content.length <= ARTIFACT_CONTEXT_CHAR_LIMIT) return content;
  return `${content.slice(0, ARTIFACT_CONTEXT_CHAR_LIMIT)}\n\n[content truncated]`;
}

function formatArtifactContext(path: string, content: string): string {
  return [
    `\`\`\`${path}`,
    truncateArtifactContent(content),
    "```",
  ].join("\n");
}

let sessionStore: FileSessionStore;

type PendingDeckBatch = {
  sessionId: string;
  jobId: string;
  batchIndex: number;
  userPrompt: string;
  model?: AgentModelSettings;
  executionStrategy: AgentExecutionStrategy;
};

const pendingDeckBatchByThread = new Map<string, PendingDeckBatch>();

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  sessionStore = new FileSessionStore(join(app.getPath("userData"), "sessions.json"));
  await sessionStore.initialize();

  const runtimes = new Map<string, SessionRuntime>();
  const sessionActiveRuns = new Map<string, string>(); // sessionId -> runId
  const activeRuns = new Map<string, AbortController>(); // runId -> AbortController
  let activeSessionId = sessionStore.getBootstrap().activeSession?.session.id ?? "";

  const ensureRuntime = async (snapshot: SessionSnapshot): Promise<SessionRuntime> => {
    const existing = runtimes.get(snapshot.session.id);
    if (existing) return existing;
    const runtime = createSessionRuntime(snapshot);
    runtimes.set(snapshot.session.id, runtime);
    return runtime;
  };

  const getActiveRuntime = async (): Promise<SessionRuntime> => {
    if (!activeSessionId) {
      throw new Error("No active session.");
    }
    return ensureRuntime(sessionStore.getSession(activeSessionId));
  };

  const getRuntimeForSession = (sessionId: string): Promise<SessionRuntime> =>
    ensureRuntime(sessionStore.getSession(sessionId));

  const initialBootstrap = sessionStore.getBootstrap();
  if (initialBootstrap.activeSession) {
    await ensureRuntime(initialBootstrap.activeSession);
  }

  const persistPresentation = async (sessionId: string, runtime: SessionRuntime) => {
    const presentation = runtime.commandBus.getSnapshot();
    await sessionStore.savePresentation(sessionId, presentation);
    return presentation;
  };

  const createDeckJobContext = (
    sessionId: string,
    runtime: SessionRuntime,
    currentRunId: string,
    sendStream: (event: AgentStreamEvent) => void,
  ) => {
    const store = sessionStore.createDeckGenerationJobStore(sessionId);
    const deckListener = (event: DeckGenerationStreamEvent) => {
      sendStream({ ...event, runId: currentRunId });
    };
    return {
      store,
      deckListener,
      readStoryboard: () => sessionStore.readStoryboard(sessionId),
      persistPresentation: () => persistPresentation(sessionId, runtime),
    };
  };

  const mapDeckRunResultToAgentResult = (deckResult: Awaited<ReturnType<typeof deckGenerationJobRunner.run>>): AgentRunResult => {
    if (deckResult.status === "completed") {
      return { status: "completed", presentation: deckResult.presentation };
    }
    if (deckResult.status === "paused") {
      return deckResult.approval;
    }
    if (deckResult.status === "chat") {
      return { status: "chat", message: deckResult.message, threadId: deckResult.threadId };
    }
    return {
      status: "chat",
      message: deckResult.message,
    };
  };

  const runDeckGenerationJob = async (options: {
    sessionId: string;
    runtime: SessionRuntime;
    request: AgentRunRequest;
    model?: AgentModelSettings;
    executionStrategy: AgentExecutionStrategy;
    currentRunId: string;
    emit: (streamEvent: AgentServiceEvent) => void;
    sendStream: (event: AgentStreamEvent) => void;
    signal?: AbortSignal;
    resumeJobId?: string;
  }): Promise<AgentRunResult> => {
    const context = createDeckJobContext(
      options.sessionId,
      options.runtime,
      options.currentRunId,
      options.sendStream,
    );
    const storyboard = await sessionStore.readStoryboard(options.sessionId);
    if (storyboard.length === 0) {
      throw new Error("Storyboard is empty. Complete slides/storyboard.json before generating the deck.");
    }

    const deckResult = await deckGenerationJobRunner.run({
      sessionId: options.sessionId,
      userPrompt: options.request.prompt,
      commandBus: options.runtime.commandBus,
      agentService: options.runtime.agentService,
      store: context.store,
      readStoryboard: context.readStoryboard,
      readArtifact: createArtifactReader(async (path) => {
        try {
          return await readAgentArtifactContext(options.sessionId, path);
        } catch {
          return undefined;
        }
      }),
      persistPresentation: context.persistPresentation,
      model: options.model,
      executionStrategy: options.executionStrategy,
      listener: options.emit,
      deckListener: context.deckListener,
      signal: options.signal,
      resumeJobId: options.resumeJobId,
    });

    if (deckResult.status === "paused" && deckResult.approval.status === "approval-required") {
      pendingDeckBatchByThread.set(deckResult.approval.approval.threadId, {
        sessionId: options.sessionId,
        jobId: deckResult.job.id,
        batchIndex: deckResult.job.pendingBatchIndex ?? deckResult.job.completedBatches,
        userPrompt: options.request.prompt,
        model: options.model,
        executionStrategy: options.executionStrategy,
      });
    }

    const agentResult = mapDeckRunResultToAgentResult(deckResult);
    if (agentResult.status === "completed") {
      await sessionStore.markProjectArtifactStatus(options.sessionId, "deck", "ready");
    }
    return agentResult;
  };

  const runAgentOperation = async (
    operation: string,
    sessionId: string,
    runId: string | undefined,
    details: Record<string, unknown>,
    task: () => Promise<AgentRunResult>,
  ): Promise<AgentRunResult> => {
    const startedAt = Date.now();
    logger.info("session.operation.started", {
      operation,
      sessionId,
      runId,
      ...details,
    });
    try {
      const result = await task();
      logger.info("session.operation.completed", {
        operation,
        sessionId,
        runId,
        status: result.status,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      logger.error("session.operation.failed", {
        operation,
        sessionId,
        runId,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  };

  const readAgentArtifactContext = async (
    sessionId: string,
    artifactIdOrPath: string,
  ): Promise<{ path: string; content: string }> => {
    const artifactPath = resolvePrimaryArtifactPath(artifactIdOrPath);
    const artifact = await sessionStore.readProjectArtifact(sessionId, artifactPath);
    if (artifact.type === "directory") {
      return {
        path: artifact.path,
        content: `Directory entries:\n${(artifact.entries ?? []).join("\n")}`,
      };
    }
    return {
      path: artifact.path,
      content: artifact.content ?? "",
    };
  };

  const loadArtifactContentsForSession = async (sessionId: string): Promise<ArtifactContentMap> => {
    const entries = await Promise.all(
      projectStageIds.map(async (stageId) => {
        try {
          const artifact = await readAgentArtifactContext(sessionId, primaryProjectArtifactPaths[stageId]);
          return [stageId, artifact.content] as const;
        } catch {
          return [stageId, ""] as const;
        }
      }),
    );
    return Object.fromEntries(entries) as ArtifactContentMap;
  };

  const resolveAgentRunRequest = async (
    request: AgentRunRequest,
    presentation: Presentation,
  ): Promise<ResolvedAgentRunRequest> => {
    if (request.stage !== "auto") return request as ResolvedAgentRunRequest;

    const artifactContents = await loadArtifactContentsForSession(request.sessionId);
    const plan = buildAgentRunPlan({
      prompt: request.prompt,
      artifactContents,
      presentation,
    });

    return {
      ...request,
      stage: plan.stage,
      intent: plan.intent,
      targetArtifactId: plan.targetArtifactId,
      targetPath: plan.targetPath,
      referencedArtifactIds: plan.referencedArtifactIds,
    };
  };

  const buildStructuredAgentPrompt = async (request: ResolvedAgentRunRequest): Promise<string> => {
    if (request.stage === "deck") {
      const runtime = await getRuntimeForSession(request.sessionId);
      const storyboard = await sessionStore.readStoryboard(request.sessionId);
      const artifactReader = createArtifactReader(async (path) => {
        try {
          return await readAgentArtifactContext(request.sessionId, path);
        } catch {
          return undefined;
        }
      });
      const context = mergeEditorContext(
        await deckContextBuilder.build({
          presentation: runtime.commandBus.getSnapshot(),
          storyboard,
          editorContext: request.editorContext,
          readArtifact: artifactReader,
        }),
        request.editorContext,
      );
      return buildDeckAgentStructuredPrompt(request.prompt, context, {
        sessionId: request.sessionId,
        stage: request.stage,
        intent: request.intent,
        targetArtifactId: request.targetArtifactId,
        targetPath: request.targetPath ?? "deck/snapshot.json",
      });
    }

    let target: { path: string; content: string } | undefined = undefined;
    let references: Array<{ path: string; content: string }> = [];

    const targetPath = request.targetPath
      ?? (request.targetArtifactId ? resolvePrimaryArtifactPath(request.targetArtifactId) : undefined)
      ?? primaryProjectArtifactPaths[request.stage];
    target = targetPath
      ? await readAgentArtifactContext(request.sessionId, targetPath)
      : undefined;

    const referenceKeys = [...new Set(request.referencedArtifactIds ?? [])]
      .map(resolvePrimaryArtifactPath)
      .filter((path) => path !== target?.path);
    const loadedRefs = await Promise.all(
      referenceKeys.map((path) => readAgentArtifactContext(request.sessionId, path)),
    );
    references = loadedRefs;

    return [
      "You are operating inside a file-native PPT creation workspace.",
      "Use the structured context below as the source of truth. Do not assume the renderer state is authoritative.",
      "",
      "User prompt:",
      request.prompt,
      "",
      "Run metadata:",
      `- sessionId: ${request.sessionId}`,
      `- stage: ${request.stage}`,
      `- intent: ${request.intent}`,
      `- targetArtifactId: ${request.targetArtifactId ?? "none"}`,
      `- targetPath: ${target?.path ?? "none"}`,
      `- referencedArtifactIds: ${(request.referencedArtifactIds ?? []).join(", ") || "none"}`,
      "",
      ...(target
        ? [
            "Target artifact content:",
            formatArtifactContext(target.path, target.content),
            "",
          ]
        : []),
      ...(references.length > 0
        ? [
            "Referenced artifact content:",
            ...references.flatMap((artifact) => [
              formatArtifactContext(artifact.path, artifact.content),
              "",
            ]),
          ]
        : []),
      "For artifact work, you MUST return an artifact_patch containing the proposed changes. Do not return command_proposal."
    ].join("\n");
  };

  const buildDeckAgentContextForRequest = async (request: ResolvedAgentRunRequest, batch?: DeckBatchPlan) => {
    const runtime = await getRuntimeForSession(request.sessionId);
    const storyboard = await sessionStore.readStoryboard(request.sessionId);
    const artifactReader = createArtifactReader(async (path) => {
      try {
        return await readAgentArtifactContext(request.sessionId, path);
      } catch {
        return undefined;
      }
    });
    return mergeEditorContext(
      await deckContextBuilder.build({
        presentation: runtime.commandBus.getSnapshot(),
        storyboard,
        batch,
        editorContext: request.editorContext,
        readArtifact: artifactReader,
      }),
      request.editorContext,
    );
  };

  ipcMain.handle("session:get-state", () => sessionStore.getBootstrap());
  ipcMain.handle("session:create", async (_, options?: CreateSessionOptions) => {
    const state = await sessionStore.createSession(options);
    activeSessionId = state.activeSession?.session.id ?? "";
    if (state.activeSession) {
      await ensureRuntime(state.activeSession);
    }
    return state;
  });
  ipcMain.handle("workspace:open", async (_, rootPath: string) => {
    const state = await sessionStore.openWorkspace(rootPath);
    activeSessionId = state.activeSession?.session.id ?? "";
    if (state.activeSession) {
      await ensureRuntime(state.activeSession);
    }
    return state;
  });
  ipcMain.handle("workspace:list-sessions", async (_, rootPath: string) =>
    sessionStore.listWorkspaceSessions(rootPath),
  );
  ipcMain.handle(
    "workspace:migrate-legacy",
    async (_, sessionId: string, targetRootPath: string) => {
      const state = await sessionStore.migrateLegacySessionToWorkspace(
        sessionId,
        targetRootPath,
      );
      activeSessionId = state.activeSession?.session.id ?? "";
      if (state.activeSession) {
        await ensureRuntime(state.activeSession);
      }
      return state;
    },
  );
  ipcMain.handle("session:select", async (_, sessionId: string) => {
    const state = await sessionStore.selectSession(sessionId);
    activeSessionId = state.activeSession?.session.id ?? "";
    if (state.activeSession) {
      await ensureRuntime(state.activeSession);
    }
    return state;
  });
  ipcMain.handle("session:delete", async (event, sessionId: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const messageBoxOptions: MessageBoxOptions = {
      type: "question",
      buttons: ["确定", "取消"],
      defaultId: 1,
      title: "确认删除",
      message: "确定要删除该会话吗？",
      cancelId: 1,
    };
    const { response } = window
      ? await dialog.showMessageBox(window, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions);
    if (response === 1) {
      return sessionStore.getBootstrap();
    }
    const state = await sessionStore.deleteSession(sessionId);
    runtimes.delete(sessionId);
    activeSessionId = state.activeSession?.session.id ?? "";
    if (state.activeSession) {
      await ensureRuntime(state.activeSession);
    }
    return state;
  });
  ipcMain.handle(
    "session:save-messages",
    (_, sessionId: string, messages: SessionChatMessage[]) =>
      sessionStore.saveMessages(sessionId, messages),
  );

  ipcMain.handle("project:list-artifacts", (_, sessionId: string) =>
    sessionStore.listProjectArtifacts(sessionId),
  );
  ipcMain.handle("project:read-artifact", (_, sessionId: string, artifactIdOrPath: string) =>
    sessionStore.readProjectArtifact(sessionId, artifactIdOrPath),
  );
  ipcMain.handle(
    "project:write-artifact",
    (_, sessionId: string, relativePath: string, content: string) =>
      sessionStore.writeProjectArtifact(sessionId, relativePath, content),
  );
  ipcMain.handle(
    "project:get-artifact-diff",
    (_, sessionId: string, relativePath: string, nextContent: string) =>
      sessionStore.getProjectArtifactDiff(sessionId, relativePath, nextContent),
  );
  ipcMain.handle(
    "project:mark-artifact-status",
    (_, sessionId: string, artifactId: string, status: unknown) =>
      sessionStore.markProjectArtifactStatus(
        sessionId,
        artifactId,
        projectArtifactStatusSchema.parse(status),
      ),
  );

  ipcMain.handle("presentation:get", async () =>
    (await getActiveRuntime()).commandBus.getSnapshot(),
  );
  ipcMain.handle("presentation:undo", async () => {
    const sessionId = activeSessionId;
    const runtime = await getActiveRuntime();
    runtime.commandBus.undo();
    return persistPresentation(sessionId, runtime);
  });
  ipcMain.handle("presentation:redo", async () => {
    const sessionId = activeSessionId;
    const runtime = await getActiveRuntime();
    runtime.commandBus.redo();
    return persistPresentation(sessionId, runtime);
  });
  ipcMain.handle("presentation:execute", async (_, command: PresentationCommand) => {
    const sessionId = activeSessionId;
    const runtime = await getActiveRuntime();
    runtime.commandBus.execute(command);
    return persistPresentation(sessionId, runtime);
  });
  ipcMain.handle(
    "presentation:export",
    async (_, presentation: Presentation, options: ExportPresentationOptions) => {
      const sessionId = activeSessionId;
      const window = BrowserWindow.getFocusedWindow();
      const dialogOptions = {
        title: "导出幻灯片",
        defaultPath: `${presentation.title || "未命名演示文稿"}.pptx`,
        filters: [
          { name: "PowerPoint 演示文稿 (*.pptx)", extensions: ["pptx"] },
          { name: "JSON 原始数据 (*.json)", extensions: ["json"] },
        ],
      };
      const { filePath, canceled } = window
        ? await dialog.showSaveDialog(window, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

      if (canceled || !filePath) {
        return null;
      }

      const result = await deckExportService.exportDeck({
        presentation,
        options,
        filePath,
      });

      if (filePath.endsWith(".pptx")) {
        await sessionStore.recordDeckExport(sessionId, {
          revision: presentation.revision,
          filePath: result.filePath,
          theme: presentation.theme ?? options.theme,
          palette: presentation.palette ?? options.palette,
        });
      }

      return result.filePath;
    },
  );
  ipcMain.handle("dialog:select-directory", async (event, defaultPath?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { filePaths, canceled } = window
      ? await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
          defaultPath,
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
          defaultPath,
        });
    if (canceled || !filePaths || filePaths.length === 0) return null;
    return filePaths[0];
  });

  ipcMain.handle("agent:cancel", async (_, runId: string) => {
    const controller = activeRuns.get(runId);
    if (controller) {
      controller.abort();
      logger.info("agent.run.cancelled", { runId });
      return true;
    }
    return false;
  });

  ipcMain.handle(
    "agent:start",
    async (
      event,
      rawRequest: unknown,
      input?: AgentModelSettings,
      strategy?: AgentExecutionStrategy,
      runId?: string,
    ) => {
      const request = agentRunRequestSchema.parse(rawRequest);
      const sessionId = request.sessionId;

      const activeRunId = sessionActiveRuns.get(sessionId);
      if (activeRunId && activeRuns.has(activeRunId)) {
        throw new Error("Concurrency Conflict: An active agent run is already in progress in this session.");
      }

      const currentRunId = runId || crypto.randomUUID();
      const controller = new AbortController();
      activeRuns.set(currentRunId, controller);
      sessionActiveRuns.set(sessionId, currentRunId);

      const runtime = await getRuntimeForSession(sessionId);
      const resolvedRequest = await resolveAgentRunRequest(
        request,
        runtime.commandBus.getSnapshot(),
      );
      const settings = input ? agentModelSettingsSchema.parse(input) : undefined;
      const executionStrategy = strategy
        ? agentExecutionStrategySchema.parse(strategy)
        : "REQUEST_APPROVAL";
      const selection = settings ? agentGateway.configure(settings) : undefined;
      const sendStream = (streamEvent: AgentStreamEvent) => {
        event.sender.send("agent:stream", streamEvent);
      };
      const emit = (streamEvent: AgentServiceEvent) => {
        sendStream({ ...streamEvent, runId: currentRunId });
      };

      try {
        const result = await runAgentOperation(
          "start",
          sessionId,
          currentRunId,
          {
            ...requestSummary(resolvedRequest.prompt),
            stage: resolvedRequest.stage,
            intent: resolvedRequest.intent,
            targetPath: resolvedRequest.targetPath,
            targetArtifactId: resolvedRequest.targetArtifactId,
            referencedArtifactIds: resolvedRequest.referencedArtifactIds,
            provider: selection?.provider,
            model: selection?.model,
            executionStrategy,
          },
          async () => {
            if (resolvedRequest.intent === "generate-deck" && resolvedRequest.stage === "deck") {
              return runDeckGenerationJob({
                sessionId,
                runtime,
                request: resolvedRequest,
                model: selection,
                executionStrategy,
                currentRunId,
                emit,
                sendStream,
                signal: controller.signal,
              });
            }

            const structuredPrompt = await buildStructuredAgentPrompt(resolvedRequest);
            const deckAgentContext = resolvedRequest.stage === "deck"
              ? await buildDeckAgentContextForRequest(resolvedRequest)
              : undefined;
            const messageHistory = sessionStore.getAgentMessageHistory(sessionId, resolvedRequest.prompt);
            const runResult = await runtime.agentService.start(
              structuredPrompt,
              selection,
              executionStrategy,
              emit,
              resolvedRequest.editorContext,
              messageHistory,
              controller.signal,
              deckAgentContext,
            );
            if (runResult.status === "completed") {
              await persistPresentation(sessionId, runtime);
              await sessionStore.markProjectArtifactStatus(sessionId, "deck", "ready");
            } else if (runResult.status === "rejected") {
              await persistPresentation(sessionId, runtime);
            }
            return runResult;
          },
        );
        return result;
      } finally {
        activeRuns.delete(currentRunId);
        if (sessionActiveRuns.get(sessionId) === currentRunId) {
          sessionActiveRuns.delete(sessionId);
        }
      }
    },
  );

  ipcMain.handle("agent:continue", async (
    event,
    threadId: string,
    rawRequest: unknown,
    runId?: string,
  ) => {
    const request = agentRunRequestSchema.parse(rawRequest);
    const sessionId = request.sessionId;

    const activeRunId = sessionActiveRuns.get(sessionId);
    if (activeRunId && activeRuns.has(activeRunId)) {
      throw new Error("Concurrency Conflict: An active agent run is already in progress in this session.");
    }

    const currentRunId = runId || crypto.randomUUID();
    const controller = new AbortController();
    activeRuns.set(currentRunId, controller);
    sessionActiveRuns.set(sessionId, currentRunId);

    const runtime = await getRuntimeForSession(sessionId);
    const resolvedRequest = await resolveAgentRunRequest(
      request,
      runtime.commandBus.getSnapshot(),
    );
    const emit = (streamEvent: AgentServiceEvent) => {
      if (currentRunId) event.sender.send("agent:stream", { ...streamEvent, runId: currentRunId });
    };

    try {
      const result = await runAgentOperation(
        "continue-agent-run",
        sessionId,
        currentRunId,
        {
          threadId,
          ...requestSummary(resolvedRequest.prompt),
          stage: resolvedRequest.stage,
          intent: resolvedRequest.intent,
          targetPath: resolvedRequest.targetPath,
          targetArtifactId: resolvedRequest.targetArtifactId,
          referencedArtifactIds: resolvedRequest.referencedArtifactIds,
        },
        async () => {
          const structuredPrompt = await buildStructuredAgentPrompt(resolvedRequest);
          const deckAgentContext = resolvedRequest.stage === "deck"
            ? await buildDeckAgentContextForRequest(resolvedRequest)
            : undefined;

          if (!runtime.agentService.hasActiveConversation(threadId)) {
            const recovered = findRecoverableConversation(
              sessionStore.getSession(sessionId).messages,
            );
            if (recovered?.threadId === threadId) {
              runtime.agentService.restoreAgentRunConversation(
                threadId,
                toAgentMessageHistory(recovered.messages, resolvedRequest.prompt),
              );
            }
          }

          if (runtime.agentService.hasActiveConversation(threadId)) {
            const runResult = await runtime.agentService.continueAgentRun(
              threadId,
              structuredPrompt,
              emit,
              resolvedRequest.editorContext,
              controller.signal,
              deckAgentContext,
            );
            if (runResult.status === "completed") {
              await persistPresentation(sessionId, runtime);
              await sessionStore.markProjectArtifactStatus(sessionId, "deck", "ready");
            } else if (runResult.status === "rejected") {
              await persistPresentation(sessionId, runtime);
            }
            return runResult;
          }

          const messageHistory = sessionStore.getAgentMessageHistory(sessionId, resolvedRequest.prompt);
          const runResult = await runtime.agentService.start(
            structuredPrompt,
            undefined,
            "REQUEST_APPROVAL",
            emit,
            resolvedRequest.editorContext,
            messageHistory,
            controller.signal,
            deckAgentContext,
          );
          if (runResult.status === "completed") {
            await persistPresentation(sessionId, runtime);
            await sessionStore.markProjectArtifactStatus(sessionId, "deck", "ready");
          } else if (runResult.status === "rejected") {
            await persistPresentation(sessionId, runtime);
          }
          return runResult;
        },
      );
      return result;
    } finally {
      activeRuns.delete(currentRunId);
      if (sessionActiveRuns.get(sessionId) === currentRunId) {
        sessionActiveRuns.delete(sessionId);
      }
    }
  });
  ipcMain.handle("agent:resume", async (event, sessionId: string, threadId: string, approved: boolean) => {
    const runtime = await getRuntimeForSession(sessionId);
    const pendingDeck = pendingDeckBatchByThread.get(threadId);
    const result = await runAgentOperation(
      "resume",
      sessionId,
      undefined,
      { threadId, approved },
      async () => {
        const runResult = await runtime.agentService.resume(threadId, approved);
        if (runResult.status === "completed") {
          await persistPresentation(sessionId, runtime);
          if (!pendingDeck) {
            await sessionStore.markProjectArtifactStatus(sessionId, "deck", "ready");
          }
        } else if (runResult.status === "artifact-updated") {
          if (runResult.write.changedArtifactId) {
            await sessionStore.markProjectArtifactStatus(
              sessionId,
              runResult.write.changedArtifactId,
              "ready",
            );
          }
        } else {
          await persistPresentation(sessionId, runtime);
        }
        return runResult;
      },
    );

    if (!pendingDeck) {
      return result;
    }

    pendingDeckBatchByThread.delete(threadId);

    if (!approved || result.status !== "completed") {
      return result;
    }

    const currentRunId = crypto.randomUUID();
    const sendStream = (streamEvent: AgentStreamEvent) => {
      event.sender.send("agent:stream", streamEvent);
    };
    const emit = (streamEvent: AgentServiceEvent) => {
      sendStream({ ...streamEvent, runId: currentRunId });
    };
    const context = createDeckJobContext(sessionId, runtime, currentRunId, sendStream);
    const store = context.store;

    await continueDeckBatchAfterApproval(deckGenerationService, {
      sessionId,
      jobId: pendingDeck.jobId,
      batchIndex: pendingDeck.batchIndex,
      commandBus: runtime.commandBus,
      store,
      readStoryboard: context.readStoryboard,
      persistPresentation: context.persistPresentation,
      deckListener: context.deckListener,
    });

    return runDeckGenerationJob({
      sessionId,
      runtime,
      request: {
        prompt: pendingDeck.userPrompt,
        sessionId,
        intent: "generate-deck",
        stage: "deck",
      },
      model: pendingDeck.model,
      executionStrategy: pendingDeck.executionStrategy,
      currentRunId,
      emit,
      sendStream,
      resumeJobId: pendingDeck.jobId,
    });
  });

  ipcMain.handle("deck:generation-status", async (_, sessionId: string) => {
    const store = sessionStore.createDeckGenerationJobStore(sessionId);
    const storyboard = await sessionStore.readStoryboard(sessionId);
    const job = await deckGenerationService.getActiveJob(store, sessionId);
    return {
      job: job ?? null,
      storyboard,
      doneSlides: storyboard.filter((slide) => slide.status === "done").length,
      pendingSlides: storyboard.filter((slide) => slide.status === "pending").length,
      failedSlides: storyboard.filter((slide) => slide.status === "failed").length,
    };
  });

  ipcMain.handle(
    "deck:generation-resume",
    async (
      event,
      sessionId: string,
      jobId?: string,
      model?: AgentModelSettings,
      strategy?: AgentExecutionStrategy,
      runId?: string,
    ) => {
      const activeRunId = sessionActiveRuns.get(sessionId);
      if (activeRunId && activeRuns.has(activeRunId)) {
        throw new Error("Concurrency Conflict: An active agent run is already in progress in this session.");
      }

      const currentRunId = runId || crypto.randomUUID();
      const controller = new AbortController();
      activeRuns.set(currentRunId, controller);
      sessionActiveRuns.set(sessionId, currentRunId);

      const runtime = await getRuntimeForSession(sessionId);
      const settings = model ? agentModelSettingsSchema.parse(model) : undefined;
      const executionStrategy = strategy
        ? agentExecutionStrategySchema.parse(strategy)
        : "REQUEST_APPROVAL";
      const selection = settings ? agentGateway.configure(settings) : undefined;
      const sendStream = (streamEvent: AgentStreamEvent) => {
        event.sender.send("agent:stream", streamEvent);
      };
      const emit = (streamEvent: AgentServiceEvent) => {
        sendStream({ ...streamEvent, runId: currentRunId });
      };

      try {
        const store = sessionStore.createDeckGenerationJobStore(sessionId);
        const activeJob =
          (jobId ? await deckGenerationService.getJob(store, sessionId, jobId) : undefined) ??
          (await deckGenerationService.getActiveJob(store, sessionId));
        if (!activeJob) {
          throw new Error("No active deck generation job to resume.");
        }

        return await runDeckGenerationJob({
          sessionId,
          runtime,
          request: {
            prompt: "Continue deck generation from the last checkpoint.",
            sessionId,
            intent: "generate-deck",
            stage: "deck",
          },
          model: selection,
          executionStrategy,
          currentRunId,
          emit,
          sendStream,
          signal: controller.signal,
          resumeJobId: activeJob.id,
        });
      } finally {
        activeRuns.delete(currentRunId);
        if (sessionActiveRuns.get(sessionId) === currentRunId) {
          sessionActiveRuns.delete(sessionId);
        }
      }
    },
  );

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
