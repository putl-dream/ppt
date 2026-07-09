import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  dialog,
  nativeTheme,
  shell,
  type MessageBoxOptions,
} from "electron";
import type { Presentation } from "@shared/presentation";
import { CommandBus, type PresentationCommand } from "@shared/commands";
import {
  agentRunRequestSchema,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentStreamEvent,
  type CreateSessionOptions,
  type ExportPresentationOptions,
  type WindowThemeMode,
} from "@shared/ipc";
import { deckExportService } from "./deck/deck-export-service";
import { slideThumbnailService } from "./deck/slide-thumbnail-service";
import { AgentService, type AgentServiceEvent } from "./agent/service";
import {
  agentExecutionStrategySchema,
  agentModelSettingsSchema,
  type AgentExecutionStrategy,
  type AgentModelSettings,
} from "@shared/agent";
import { agentStepLimitsSchema, type AgentStepLimits } from "@shared/agent-step-limits";
import { agentGatewayConfigSchema, type AgentGatewayConfig } from "@shared/agent-gateway-config";
import { AgentGateway } from "./agent/gateway";
import { AgentRuntime } from "./agent/runtime/agent-runtime";
import { ToolApprovalBroker } from "./agent/runtime/tool-approval-broker";
import { createDefaultToolRegistry } from "./agent/tools/tool-registry";
import { formatMailboxMessagesForHistory, MessageBus } from "./agent/teammate/message-bus";
import { TeammateManager } from "./agent/teammate/spawn-teammate";
import { CommitGate } from "./agent/gate/commit-gate";
import { scanSkills, type SkillRegistry } from "./agent/skills/loadSkillsDir";
import { createEmptySkillRegistry } from "./agent/skills/loadSkillsDir";
import { RiskPolicy } from "./agent/gate/risk-policy";
import { createModuleLogger, requestSummary } from "./agent/logger";
import { FileSessionStore } from "./session-store";
import type { SessionChatMessage, SessionSnapshot } from "@shared/session";
import { projectArtifactStatusSchema } from "@shared/session";
import {
  findRecoverableConversation,
} from "@shared/session-recovery";
import type { AgentModelSelection } from "@shared/agent";

const logger = createModuleLogger("main");
const agentGateway = new AgentGateway();
const toolApprovalBroker = new ToolApprovalBroker();
type WindowThemePreset = Exclude<WindowThemeMode, "system">;

async function resolveSkillRegistry(): Promise<SkillRegistry> {
  const candidates = [
    join(process.cwd(), "skills"),
    join(app.getAppPath(), "skills"),
    join(__dirname, "../../skills"),
  ];

  for (const skillsDir of candidates) {
    const registry = await scanSkills(skillsDir);
    if (registry.size > 0) {
      logger.info("skills.registry.loaded", { skillsDir, count: registry.size });
      return registry;
    }
  }

  return createEmptySkillRegistry();
}

interface SessionRuntime {
  commandBus: CommandBus;
  agentService: AgentService;
  messageBus?: MessageBus;
  teammateManager?: TeammateManager;
  workspaceRoot?: string;
}

function createSessionRuntime(snapshot: SessionSnapshot, skillRegistry: SkillRegistry): SessionRuntime {
  const commandBus = new CommandBus(snapshot.presentation);
  const registry = createDefaultToolRegistry();
  const messageBus = snapshot.project?.rootPath
    ? new MessageBus(MessageBus.defaultMailboxDir(snapshot.project.rootPath))
    : undefined;
  const teammateManager = messageBus ? new TeammateManager(messageBus) : undefined;
  const agentService = new AgentService(
    commandBus,
    new AgentRuntime(registry, agentGateway, skillRegistry),
    new CommitGate(new RiskPolicy()),
    snapshot.project?.rootPath,
    toolApprovalBroker,
    messageBus,
    teammateManager,
  );
  return {
    commandBus,
    agentService,
    messageBus,
    teammateManager,
    workspaceRoot: snapshot.project?.rootPath,
  };
}

function createWindow(): void {
  const icon = resolveAppIconPath();
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Agent PPT",
    titleBarStyle: "hidden",
    titleBarOverlay: getWindowTitleBarOverlay(),
    backgroundColor: getWindowBackgroundColor(),
    ...(icon ? { icon } : {}),
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

let sessionStore: FileSessionStore;

let activeWindowThemeMode: WindowThemeMode = "light";

const WINDOW_FRAME_BY_THEME: Record<WindowThemePreset, { background: string; symbol: string; nativeTheme: "light" | "dark" }> = {
  light: {
    background: "#e7e7e7",
    symbol: "#0f172a",
    nativeTheme: "light",
  },
  dark: {
    background: "#141414",
    symbol: "#f8fafc",
    nativeTheme: "dark",
  },
  cyan: {
    background: "#d8edf0",
    symbol: "#0f172a",
    nativeTheme: "light",
  },
  orange: {
    background: "#efe2cf",
    symbol: "#0f172a",
    nativeTheme: "light",
  },
};

function resolveAppIconPath(): string | undefined {
  const candidates = [
    join(process.cwd(), "build", "icon.ico"),
    join(process.cwd(), "build", "icon.png"),
    join(process.resourcesPath, "icon.ico"),
    join(process.resourcesPath, "icon.png"),
    join(app.getAppPath(), "build", "icon.ico"),
    join(app.getAppPath(), "build", "icon.png"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function resolveWindowThemeMode(themeMode: WindowThemeMode = activeWindowThemeMode): WindowThemePreset {
  if (themeMode === "system") {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }
  return themeMode;
}

function normalizeWindowThemeMode(themeMode: unknown): WindowThemeMode {
  if (
    themeMode === "light"
    || themeMode === "dark"
    || themeMode === "cyan"
    || themeMode === "orange"
    || themeMode === "system"
  ) {
    return themeMode;
  }
  return "light";
}

function getWindowBackgroundColor(): string {
  return WINDOW_FRAME_BY_THEME[resolveWindowThemeMode()].background;
}

function getWindowTitleBarOverlay(): Electron.TitleBarOverlay {
  const frame = WINDOW_FRAME_BY_THEME[resolveWindowThemeMode()];
  return {
    color: frame.background,
    symbolColor: frame.symbol,
    height: 30,
  };
}

function applyWindowBackgroundColor(): void {
  const backgroundColor = getWindowBackgroundColor();
  const titleBarOverlay = getWindowTitleBarOverlay();

  for (const browserWindow of BrowserWindow.getAllWindows()) {
    browserWindow.setBackgroundColor(backgroundColor);
    browserWindow.setTitleBarOverlay(titleBarOverlay);
  }
}

function applyWindowThemeMode(themeMode: WindowThemeMode): "light" | "dark" {
  activeWindowThemeMode = themeMode;
  const resolvedMode = resolveWindowThemeMode(themeMode);
  nativeTheme.themeSource = WINDOW_FRAME_BY_THEME[resolvedMode].nativeTheme;
  const resolvedTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  applyWindowBackgroundColor();

  return resolvedTheme;
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.agent-ppt.app");
  }

  Menu.setApplicationMenu(null);
  sessionStore = new FileSessionStore(join(app.getPath("userData"), "sessions.json"));
  await sessionStore.initialize();

  const skillRegistry = await resolveSkillRegistry();

  const runtimes = new Map<string, SessionRuntime>();
  const sessionActiveRuns = new Map<string, string>(); // sessionId -> runId
  const activeRuns = new Map<string, AbortController>(); // runId -> AbortController
  let activeSessionId = sessionStore.getBootstrap().activeSession?.session.id ?? "";

  const ensureRuntime = async (snapshot: SessionSnapshot): Promise<SessionRuntime> => {
    const existing = runtimes.get(snapshot.session.id);
    if (existing && existing.workspaceRoot === snapshot.project?.rootPath) return existing;
    const runtime = createSessionRuntime(snapshot, skillRegistry);
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

  const finalizeAgentResult = async (
    sessionId: string,
    runtime: SessionRuntime,
    result: AgentRunResult,
  ): Promise<AgentRunResult> => {
    if (result.status === "completed") {
      await persistPresentation(sessionId, runtime);
      await sessionStore.markProjectArtifactStatus(sessionId, "deck", "ready");
    } else if (result.status === "rejected") {
      await persistPresentation(sessionId, runtime);
    }
    return result;
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

  ipcMain.handle("session:get-state", () => sessionStore.getBootstrap());
  ipcMain.handle("window:set-theme-mode", (_event, themeMode: unknown) =>
    applyWindowThemeMode(normalizeWindowThemeMode(themeMode)),
  );
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
          { name: "HTML 网页 (*.html)", extensions: ["html"] },
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
  ipcMain.handle("shell:open-export-folder", async (_, filePath: string) => {
    if (typeof filePath !== "string" || !filePath.trim()) {
      return false;
    }

    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("agent:cancel", async (_, runId: string) => {
    toolApprovalBroker.cancelForRun(runId);
    const controller = activeRuns.get(runId);
    if (controller) {
      controller.abort();
      logger.info("agent.run.cancelled", { runId });
      return true;
    }
    return false;
  });

  ipcMain.handle("agent:cancel-session", async (_, sessionId: string) => {
    const runId = sessionActiveRuns.get(sessionId);
    if (!runId) return false;
    toolApprovalBroker.cancelForRun(runId);
    const controller = activeRuns.get(runId);
    if (controller) {
      controller.abort();
      logger.info("agent.session.cancelled", { sessionId, runId });
      return true;
    }
    return false;
  });

  ipcMain.handle(
    "agent:resolve-tool-approval",
    async (_, runId: string, approvalId: string, approved: boolean) =>
      toolApprovalBroker.resolve(approvalId, approved),
  );

  ipcMain.handle("agent:poll-lead-inbox", async (_, sessionId: string) => {
    const runtime = await getRuntimeForSession(sessionId);
    const messages = runtime.messageBus
      ? await runtime.messageBus.peekInbox("lead")
      : [];
    return {
      hasMessages: messages.length > 0,
      count: messages.length,
      preview: formatMailboxMessagesForHistory(messages.slice(0, 5)),
      types: Array.from(new Set(messages.map((message) => message.type))),
    };
  });

  ipcMain.handle(
    "agent:start",
    async (
      event,
      rawRequest: unknown,
      input?: AgentModelSettings,
      strategy?: AgentExecutionStrategy,
      rawStepLimits?: AgentStepLimits,
      rawGatewayConfig?: AgentGatewayConfig,
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
      const agentStepLimits = rawStepLimits
        ? agentStepLimitsSchema.parse(rawStepLimits)
        : undefined;
      const gatewayConfig = rawGatewayConfig
        ? agentGatewayConfigSchema.parse(rawGatewayConfig)
        : undefined;
      let selection: AgentModelSelection | undefined;
      if (settings) {
        selection = agentGateway.configure(settings, gatewayConfig);
      } else if (gatewayConfig) {
        agentGateway.applyGatewayConfig(gatewayConfig);
      }
      const emit = (streamEvent: AgentServiceEvent) => {
        event.sender.send("agent:stream", { ...streamEvent, runId: currentRunId });
      };

      try {
        return await runAgentOperation(
          "start",
          sessionId,
          currentRunId,
          {
            ...requestSummary(request.prompt),
            provider: selection?.provider,
            model: selection?.model,
            executionStrategy,
          },
          async () => finalizeAgentResult(
            sessionId,
            runtime,
            await runtime.agentService.start(
              request.prompt,
              selection,
              executionStrategy,
              emit,
              request.editorContext,
              sessionStore.getAgentMessageHistory(sessionId, request.prompt),
              controller.signal,
              currentRunId,
              agentStepLimits,
            ),
          ),
        );
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
    rawModelSettings?: AgentModelSettings,
    rawStepLimits?: AgentStepLimits,
    rawGatewayConfig?: AgentGatewayConfig,
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
    const settings = rawModelSettings
      ? agentModelSettingsSchema.parse(rawModelSettings)
      : undefined;
    const agentStepLimits = rawStepLimits
      ? agentStepLimitsSchema.parse(rawStepLimits)
      : undefined;
    const gatewayConfig = rawGatewayConfig
      ? agentGatewayConfigSchema.parse(rawGatewayConfig)
      : undefined;
    let selection: AgentModelSelection | undefined;
    if (settings) {
      selection = agentGateway.configure(settings, gatewayConfig);
    } else if (gatewayConfig) {
      agentGateway.applyGatewayConfig(gatewayConfig);
    }
    const emit = (streamEvent: AgentServiceEvent) => {
      event.sender.send("agent:stream", { ...streamEvent, runId: currentRunId });
    };

    try {
      return await runAgentOperation(
        "continue-agent-run",
        sessionId,
        currentRunId,
        { threadId, ...requestSummary(request.prompt) },
        async () => {
          if (!runtime.agentService.hasActiveConversation(threadId)) {
            const recovered = findRecoverableConversation(
              sessionStore.getSession(sessionId).messages,
            );
            if (recovered?.threadId === threadId) {
              runtime.agentService.restoreAgentRunConversation(
                threadId,
                recovered.messages,
              );
            }
          }

          const run = runtime.agentService.hasActiveConversation(threadId)
            ? runtime.agentService.continueAgentRun(
                threadId,
                request.prompt,
                emit,
                request.editorContext,
                controller.signal,
                currentRunId,
                agentStepLimits,
              )
            : runtime.agentService.start(
                request.prompt,
                selection,
                "REQUEST_APPROVAL",
                emit,
                request.editorContext,
                sessionStore.getAgentMessageHistory(sessionId, request.prompt),
                controller.signal,
                currentRunId,
                agentStepLimits,
              );

          return finalizeAgentResult(sessionId, runtime, await run);
        },
      );
    } finally {
      activeRuns.delete(currentRunId);
      if (sessionActiveRuns.get(sessionId) === currentRunId) {
        sessionActiveRuns.delete(sessionId);
      }
    }
  });

  ipcMain.handle("agent:resume", async (_event, sessionId: string, threadId: string, approved: boolean) => {
    const runtime = await getRuntimeForSession(sessionId);
    return runAgentOperation(
      "resume",
      sessionId,
      undefined,
      { threadId, approved },
      async () => finalizeAgentResult(
        sessionId,
        runtime,
        await runtime.agentService.resume(threadId, approved),
      ),
    );
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  slideThumbnailService.dispose();
});
