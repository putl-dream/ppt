import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, dialog, type MessageBoxOptions } from "electron";
import { CommandBus, type PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import {
  agentRunRequestSchema,
  type AgentRunRequest,
  type AgentRunResult,
  type ExportPresentationOptions,
} from "@shared/ipc";
import { deckExportService } from "./deck/deck-export-service";
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
import { isProjectStageId, primaryProjectArtifactPaths } from "@shared/project";

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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  sessionStore = new FileSessionStore(join(app.getPath("userData"), "sessions.json"));
  await sessionStore.initialize();

  const runtimes = new Map<string, SessionRuntime>();
  const sessionActiveRuns = new Map<string, string>(); // sessionId -> runId
  const activeRuns = new Map<string, AbortController>(); // runId -> AbortController
  let activeSessionId = sessionStore.getBootstrap().activeSession.session.id;

  const ensureRuntime = async (snapshot: SessionSnapshot): Promise<SessionRuntime> => {
    const existing = runtimes.get(snapshot.session.id);
    if (existing) return existing;
    const runtime = createSessionRuntime(snapshot);
    runtimes.set(snapshot.session.id, runtime);
    return runtime;
  };

  const getActiveRuntime = (): Promise<SessionRuntime> =>
    ensureRuntime(sessionStore.getSession(activeSessionId));

  const getRuntimeForSession = (sessionId: string): Promise<SessionRuntime> =>
    ensureRuntime(sessionStore.getSession(sessionId));

  await ensureRuntime(sessionStore.getSession(activeSessionId));

  const persistPresentation = async (sessionId: string, runtime: SessionRuntime) => {
    const presentation = runtime.commandBus.getSnapshot();
    await sessionStore.savePresentation(sessionId, presentation);
    return presentation;
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

  const buildStructuredAgentPrompt = async (request: AgentRunRequest): Promise<string> => {
    let target: { path: string; content: string } | undefined = undefined;
    let references: Array<{ path: string; content: string }> = [];

    if (request.stage === "deck") {
      const targetPath = "deck/snapshot.json";
      try {
        target = await readAgentArtifactContext(request.sessionId, targetPath);
      } catch (e) {
        // ignore if not present
      }

      const upstreams = [
        "brief.md",
        "outline.md",
        "research/notes.md",
        "slides/storyboard.json",
        "design/theme.json",
      ];
      const loadedRefs = await Promise.all(
        upstreams.map(async (path) => {
          try {
            return await readAgentArtifactContext(request.sessionId, path);
          } catch (e) {
            return undefined;
          }
        })
      );
      references = loadedRefs.filter((r): r is { path: string; content: string } => r !== undefined);
    } else {
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
    }

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
      request.stage === "deck"
        ? "For deck work, you MUST only return a command_proposal containing PresentationCommands. You are not allowed to return artifact_patch or ordinary message content as the final outcome."
        : "For artifact work, you MUST return an artifact_patch containing the proposed changes. Do not return command_proposal."
    ].join("\n");
  };

  ipcMain.handle("session:get-state", () => sessionStore.getBootstrap());
  ipcMain.handle("session:create", async () => {
    const state = await sessionStore.createSession();
    activeSessionId = state.activeSession.session.id;
    await ensureRuntime(state.activeSession);
    return state;
  });
  ipcMain.handle("session:select", async (_, sessionId: string) => {
    const state = await sessionStore.selectSession(sessionId);
    activeSessionId = state.activeSession.session.id;
    await ensureRuntime(state.activeSession);
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
    activeSessionId = state.activeSession.session.id;
    await ensureRuntime(state.activeSession);
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
      const settings = input ? agentModelSettingsSchema.parse(input) : undefined;
      const executionStrategy = strategy
        ? agentExecutionStrategySchema.parse(strategy)
        : "REQUEST_APPROVAL";
      const selection = settings ? agentGateway.configure(settings) : undefined;
      const emit = (streamEvent: AgentServiceEvent) => {
        if (currentRunId) event.sender.send("agent:stream", { ...streamEvent, runId: currentRunId });
      };

      try {
        const result = await runAgentOperation(
          "start",
          sessionId,
          currentRunId,
          {
            ...requestSummary(request.prompt),
            stage: request.stage,
            intent: request.intent,
            targetPath: request.targetPath,
            targetArtifactId: request.targetArtifactId,
            referencedArtifactIds: request.referencedArtifactIds,
            provider: selection?.provider,
            model: selection?.model,
            executionStrategy,
          },
          async () => {
            const structuredPrompt = await buildStructuredAgentPrompt(request);
            const messageHistory = sessionStore.getAgentMessageHistory(sessionId, request.prompt);
            const runResult = await runtime.agentService.start(
              structuredPrompt,
              selection,
              executionStrategy,
              emit,
              request.editorContext,
              messageHistory,
              controller.signal,
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
          ...requestSummary(request.prompt),
          stage: request.stage,
          intent: request.intent,
          targetPath: request.targetPath,
          targetArtifactId: request.targetArtifactId,
          referencedArtifactIds: request.referencedArtifactIds,
        },
        async () => {
          const structuredPrompt = await buildStructuredAgentPrompt(request);
          const runResult = await runtime.agentService.continueAgentRun(
            threadId,
            structuredPrompt,
            emit,
            request.editorContext,
            controller.signal,
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
  ipcMain.handle("agent:resume", async (_, threadId: string, approved: boolean) => {
    const sessionId = activeSessionId;
    const runtime = await getActiveRuntime();
    const result = await runAgentOperation(
      "resume",
      sessionId,
      undefined,
      { threadId, approved },
      async () => {
        const runResult = await runtime.agentService.resume(threadId, approved);
        if (runResult.status === "completed") {
          await persistPresentation(sessionId, runtime);
          await sessionStore.markProjectArtifactStatus(sessionId, "deck", "ready");
        } else {
          await persistPresentation(sessionId, runtime);
        }
        return runResult;
      },
    );
    return result;
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
