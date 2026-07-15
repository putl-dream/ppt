import { existsSync, mkdirSync } from "node:fs";
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
  type WebContents,
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
import {
  clearLogFiles,
  createModuleLogger,
  getLogDirectory,
  getLogManagerStatus,
  getRecentLogEntries,
  initializeLogManager,
  requestSummary,
  updateLogManagerSettings,
} from "./agent/logger";
import type { AppLogLevel, LogManagerSettings, RendererLogReport } from "@shared/logging";
import { FileSessionStore } from "./session-store";
import { TaskStore } from "./agent/task/task-store";
import type { SessionChatMessage, SessionSnapshot } from "@shared/session";
import { projectArtifactStatusSchema } from "@shared/session";
import {
  findRecoverableConversation,
} from "@shared/session-recovery";
import type { AgentModelSelection } from "@shared/agent";
import { TokenUsageStore } from "./token-usage-store";
import type { ConversationEventKind } from "@shared/conversation-events";
import {
  toResultDisplayEvents,
  toStreamDisplayEvent,
} from "./agent/display/display-event-adapter";

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
  runtimeRoot: string;
}

function createSessionRuntime(
  snapshot: SessionSnapshot,
  skillRegistry: SkillRegistry,
  applicationDataRoot: string,
): SessionRuntime {
  const commandBus = new CommandBus(snapshot.presentation);
  const registry = createDefaultToolRegistry();
  const runtimeRoot = join(applicationDataRoot, "runtime", snapshot.session.id);
  const messageBus = new MessageBus(MessageBus.defaultMailboxDir(runtimeRoot));
  const teammateManager = new TeammateManager(messageBus);
  const agentService = new AgentService(
    commandBus,
    new AgentRuntime(registry, agentGateway, skillRegistry, sessionStore.conversationDatabase),
    new CommitGate(new RiskPolicy()),
    snapshot.project?.rootPath,
    toolApprovalBroker,
    messageBus,
    teammateManager,
    sessionStore.conversationDatabase,
    runtimeRoot,
  );
  return {
    commandBus,
    agentService,
    messageBus,
    teammateManager,
    workspaceRoot: snapshot.project?.rootPath,
    runtimeRoot,
  };
}

function createAgentStreamEmitter(
  sender: WebContents,
  sessionId: string,
  runId: string,
  controller: AbortController,
): (streamEvent: AgentServiceEvent) => void {
  const abortRun = (reason: string) => {
    if (controller.signal.aborted) return;
    controller.abort();
    toolApprovalBroker.cancelForRun(runId);
    logger.info("agent.run.aborted", { runId, reason });
  };

  return (streamEvent: AgentServiceEvent) => {
    const eventKind: ConversationEventKind = (() => {
      switch (streamEvent.type) {
        case "thinking-chunk":
        case "teammate-thinking-chunk":
          return "reasoning_chunk";
        case "text-chunk": return "text_chunk";
        case "stage-started": return "stage_started";
        case "workflow-progress":
        case "request-status":
        case "teammate-assignment-started":
        case "teammate-assignment-finished":
          return "workflow_progress";
        case "tool-started":
        case "teammate-tool-started":
          return "tool_started";
        case "tool-finished":
        case "teammate-tool-finished":
          return "tool_finished";
        case "tool-validation-failed": return "tool_failed";
        case "approval-waiting":
        case "tool-approval-waiting":
          return "approval_requested";
        case "task-graph-updated": return "task_graph_updated";
        default: return "workflow_progress";
      }
    })();
    sessionStore.conversationDatabase.appendEvent({
      sessionId,
      runId,
      threadId: runId,
      kind: eventKind,
      payload: structuredClone(streamEvent) as unknown as Record<string, unknown>,
    });
    if (
      streamEvent.type === "task-graph-updated"
      || streamEvent.type === "teammate-assignment-finished"
    ) {
      void sessionStore.refreshAgentRunTrace(sessionId, runId).catch((error) => {
        logger.warn("agent.task-graph-trace.persist-failed", { sessionId, runId, error });
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
  };
}

function createWindow(onWindowCreated?: (window: BrowserWindow) => void): BrowserWindow {
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
    logger.error("renderer.load.failed", { errorCode, errorDescription, validatedUrl });
  });
  window.webContents.on("did-finish-load", () => {
    logger.info("renderer.load.completed", { webContentsId: window.webContents.id });
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  onWindowCreated?.(window);
  return window;
}

let sessionStore: FileSessionStore;
let tokenUsageStore: TokenUsageStore;

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
  const applicationDataRoot = join(app.getPath("appData"), ".agent-ppt");
  process.env.AGENT_PPT_DATA_DIR = applicationDataRoot;
  await initializeLogManager();
  logger.info("application.started", {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });
  sessionStore = new FileSessionStore(join(applicationDataRoot, "conversations.sqlite"));
  await sessionStore.initialize();
  tokenUsageStore = new TokenUsageStore(join(applicationDataRoot, "token-usage.json"));
  await tokenUsageStore.initialize();
  agentGateway.setUsageRecorder((record) => tokenUsageStore.recordModelUsage(record));

  const skillRegistry = await resolveSkillRegistry();

  const runtimes = new Map<string, SessionRuntime>();
  const sessionActiveRuns = new Map<string, string>(); // sessionId -> runId
  const activeRuns = new Map<string, AbortController>(); // runId -> AbortController
  let activeSessionId = sessionStore.getBootstrap().activeSession?.session.id ?? "";

  const ensureRuntime = async (snapshot: SessionSnapshot): Promise<SessionRuntime> => {
    const existing = runtimes.get(snapshot.session.id);
    if (existing && existing.workspaceRoot === snapshot.project?.rootPath) return existing;
    const runtimeRoot = join(applicationDataRoot, "runtime", snapshot.session.id);
    await new TaskStore(runtimeRoot).recoverInterruptedClaims();
    const runtime = createSessionRuntime(snapshot, skillRegistry, applicationDataRoot);
    await runtime.teammateManager?.reconcileInterrupted();
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
    runId?: string,
  ): Promise<AgentRunResult> => {
    if (result.status === "completed") {
      await persistPresentation(sessionId, runtime);
      await sessionStore.markProjectArtifactStatus(sessionId, "deck", "ready");
    } else if (result.status === "rejected") {
      await persistPresentation(sessionId, runtime);
    }
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
      toolApprovalBroker.cancelForRun(runId);
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
      if (runId) {
        sessionStore.conversationDatabase.finishRun({
          runId,
          status: "completed",
          result,
          threadId: "threadId" in result && typeof result.threadId === "string"
            ? result.threadId
            : runId,
        });
        await sessionStore.finalizeAgentRunMessage(sessionId, runId, result);
      }
      logger.info("session.operation.completed", {
        operation,
        sessionId,
        runId,
        status: result.status,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      if (runId) {
        const message = error instanceof Error ? error.message : String(error);
        const interrupted = /aborted|中断|取消/i.test(message);
        sessionStore.conversationDatabase.finishRun({
          runId,
          status: interrupted ? "interrupted" : "failed",
          error: message,
        });
        await sessionStore.failAgentRunMessage(sessionId, runId, message);
      }
      logger.error("session.operation.failed", {
        operation,
        sessionId,
        runId,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    } finally {
      await tokenUsageStore.recordTask(Date.now() - startedAt).catch((error) => {
        logger.error("session.operation.usage-persist-failed", {
          operation,
          sessionId,
          runId,
          error,
        });
      });
    }
  };

  ipcMain.handle("session:get-state", () => sessionStore.getBootstrap());
  ipcMain.handle("token-usage:get-stats", () => tokenUsageStore.getStats());
  ipcMain.handle("logs:get-status", () => getLogManagerStatus());
  ipcMain.handle("logs:get-recent", (_event, limit?: number, minimumLevel?: AppLogLevel) =>
    getRecentLogEntries(limit, minimumLevel),
  );
  ipcMain.handle("logs:update-settings", async (_event, patch: Partial<LogManagerSettings>) => {
    const settings = await updateLogManagerSettings(patch ?? {});
    logger.info("logs.settings.updated", { ...settings });
    return settings;
  });
  ipcMain.handle("logs:clear", async () => clearLogFiles());
  ipcMain.handle("logs:open-directory", async () => {
    const directory = getLogDirectory();
    mkdirSync(directory, { recursive: true });
    const errorMessage = await shell.openPath(directory);
    if (errorMessage) {
      logger.warn("logs.directory.open-failed", { directory, errorMessage });
      return false;
    }
    return true;
  });
  ipcMain.on("logs:renderer-report", (_event, report: RendererLogReport) => {
    if (!report || !["debug", "info", "warn", "error"].includes(report.level)) return;
    if (typeof report.event !== "string" || !report.event.trim()) return;
    logger[report.level](`renderer.${report.event}`, report.data);
  });
  ipcMain.handle("window:set-theme-mode", (_event, themeMode: unknown) =>
    applyWindowThemeMode(normalizeWindowThemeMode(themeMode)),
  );
  ipcMain.handle("session:create", async (_, options?: CreateSessionOptions) => {
    const startedAt = Date.now();
    const state = await sessionStore.createSession(options);
    activeSessionId = state.activeSession?.session.id ?? "";
    if (state.activeSession) {
      await ensureRuntime(state.activeSession);
    }
    logger.info("session.created", {
      sessionId: activeSessionId,
      hasWorkspace: Boolean(options?.rootPath),
      durationMs: Date.now() - startedAt,
    });
    return state;
  });
  ipcMain.handle("workspace:open", async (_, rootPath: string) => {
    const startedAt = Date.now();
    const state = await sessionStore.openWorkspace(rootPath);
    activeSessionId = state.activeSession?.session.id ?? "";
    if (state.activeSession) {
      await ensureRuntime(state.activeSession);
    }
    logger.info("workspace.opened", {
      sessionId: activeSessionId,
      rootPath,
      durationMs: Date.now() - startedAt,
    });
    return state;
  });
  ipcMain.handle("workspace:list-sessions", async (_, rootPath: string) =>
    sessionStore.listWorkspaceSessions(rootPath),
  );
  ipcMain.handle("session:select", async (_, sessionId: string) => {
    const startedAt = Date.now();
    const state = await sessionStore.selectSession(sessionId);
    activeSessionId = state.activeSession?.session.id ?? "";
    if (state.activeSession) {
      await ensureRuntime(state.activeSession);
    }
    logger.info("session.selected", { sessionId, durationMs: Date.now() - startedAt });
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
    logger.info("session.deleted", { sessionId, nextSessionId: activeSessionId || undefined });
    return state;
  });
  ipcMain.handle(
    "session:save-messages",
    (_, sessionId: string, messages: SessionChatMessage[]) =>
      sessionStore.saveMessages(sessionId, messages),
  );
  ipcMain.handle(
    "conversation:load-events",
    (_, sessionId: string, cursor?: number, limit?: number) =>
      sessionStore.conversationDatabase.listEvents(sessionId, cursor, limit),
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
      const startedAt = Date.now();
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
        logger.info("presentation.export.cancelled", { sessionId });
        return null;
      }

      logger.info("presentation.export.started", {
        sessionId,
        revision: presentation.revision,
        slideCount: presentation.slides.length,
        format: filePath.split(".").pop()?.toLowerCase(),
      });
      try {
        const result = await deckExportService.exportDeck({
          presentation,
          options,
          filePath,
        });

        if (filePath.endsWith(".pptx")) {
          await sessionStore.recordDeckExport(sessionId, {
            revision: presentation.revision,
            filePath: result.filePath,
            designSystem: presentation.designSystem,
          });
        }

        logger.info("presentation.export.completed", {
          sessionId,
          filePath: result.filePath,
          durationMs: Date.now() - startedAt,
        });
        return result.filePath;
      } catch (error) {
        logger.error("presentation.export.failed", {
          sessionId,
          filePath,
          durationMs: Date.now() - startedAt,
          error,
        });
        throw error;
      }
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
      sessionStore.conversationDatabase.beginRun({
        runId: currentRunId,
        sessionId,
        threadId: currentRunId,
        provider: selection?.provider,
        model: selection?.model,
        request: request.prompt,
      });
      const emit = createAgentStreamEmitter(event.sender, sessionId, currentRunId, controller);

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
              request.layoutChoice,
            ),
            currentRunId,
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
    sessionStore.conversationDatabase.beginRun({
      runId: currentRunId,
      sessionId,
      threadId,
      provider: selection?.provider,
      model: selection?.model,
      request: request.prompt,
    });
    const emit = createAgentStreamEmitter(event.sender, sessionId, currentRunId, controller);

    try {
      return await runAgentOperation(
        "continue-agent-run",
        sessionId,
        currentRunId,
        { threadId, ...requestSummary(request.prompt) },
        async () => {
          await runtime.agentService.restoreDurableThread(threadId);
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
                request.layoutChoice,
                selection,
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
                request.layoutChoice,
              );

          return finalizeAgentResult(sessionId, runtime, await run, currentRunId);
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

  createWindow(attachWindowLifecycle);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(attachWindowLifecycle);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  logger.info("application.stopping");
  slideThumbnailService.dispose();
  sessionStore?.conversationDatabase.close();
});

process.on("uncaughtExceptionMonitor", (error) => {
  logger.error("process.uncaught-exception", { error });
});

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled-rejection", { reason });
});

app.on("child-process-gone", (_event, details) => {
  logger.error("application.child-process-gone", { ...details });
});
