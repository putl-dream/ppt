import { existsSync, mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
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
import { CommandBus } from "@shared/commands";
import {
  agentRunRequestSchema,
  exportPresentationOptionsSchema,
  projectArtifactDiffRequestSchema,
  projectFileOpenRequestSchema,
  projectFileSaveRequestSchema,
  projectFileSessionIdSchema,
  type AgentRunResult,
  type AgentStreamEvent,
  type CreateSessionOptions,
  type ExportPresentationOptions,
  type WindowThemeMode,
} from "@shared/ipc";
import { deckExportService } from "./deck/deck-export-service";
import { recoverInterruptedExport } from
  "./deck/export-recovery";
import { slideThumbnailService } from "./deck/slide-thumbnail-service";
import { AgentService, type AgentServiceEvent } from "./agent/service";
import {
  agentExecutionStrategySchema,
  agentModelSettingsSchema,
  type AgentExecutionStrategy,
  type AgentModelSettings,
} from "@shared/agent";
import { agentStepLimitsSchema, type AgentStepLimits } from "@shared/agent-step-limits";
import { agentRunServicesWireSchema, splitAgentRunServicesConfig, type AgentGatewayConfig } from "@shared/agent-gateway-config";
import { AgentGateway } from "./agent/gateway";
import { AgentRuntime } from "./agent/runtime/agent-runtime";
import { ToolApprovalBroker } from "./agent/runtime/tools/tool-approval-broker";
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
  diagnosticValuePreview,
  getLogDirectory,
  getLogManagerStatus,
  getRecentLogEntries,
  initializeLogManager,
  requestSummary,
  updateLogManagerSettings,
  withLogContext,
} from "./agent/logger";
import type { AppLogLevel, LogManagerSettings, RendererLogReport } from "@shared/logging";
import { FileSessionStore } from "./session-store";
import type { SessionChatMessage, SessionSnapshot } from "@shared/session";
import type { PersistedDisplayCard } from "@shared/card-display-protocol";
import {
  findRecoverableConversation,
} from "@shared/session-recovery";
import { resolveExternalHttpUrl } from "./external-navigation";
import type { AgentModelSelection } from "@shared/agent";
import { TokenUsageStore } from "./token-usage-store";
import type { ConversationEventKind } from "@shared/conversation-events";
import {
  toResultDisplayEvents,
  toStreamDisplayEvent,
} from "./agent/display/display-event-adapter";
import { isRuntimeCancellation } from "./agent/runtime/lifecycle/runtime-cancellation";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import { isTeammateProgressEvent } from "@shared/teammate-progress";
import { configureApplicationDataRoot, getApplicationDataRoot } from "./application-data";
import {
  ensureUiThemesDirectory,
  listUiThemes,
  readUiThemeCss,
} from "./ui-themes";
import {
  asPresentationId,
  asProjectId,
  asProposalId,
  type ProjectId,
  type PptJobProjection,
} from "@shared/presentation-lifecycle";
import {
  ContentAddressedBlobStore,
  canonicalJson,
  hashArtifactValue,
  hashBytes,
} from
  "./presentation-lifecycle/content-addressed-blob-store";
import { PresentationLifecycleOrchestrator } from
  "./presentation-lifecycle/presentation-lifecycle-orchestrator";
import { PresentationLifecycleRepository } from
  "./presentation-lifecycle/presentation-lifecycle-repository";
import { PresentationLifecycleToolBridge } from
  "./presentation-lifecycle/presentation-lifecycle-tool-bridge";
import { PresentationCommitService } from
  "./presentation-lifecycle/presentation-commit-service";
import { PresentationArtifactChangeObserver } from
  "./presentation-lifecycle/artifact-change-observer";

const { applicationDataRoot } = configureApplicationDataRoot(app);
ensureUiThemesDirectory(applicationDataRoot);

const logger = createModuleLogger("main");
const agentGateway = new AgentGateway();
const toolApprovalBroker = new ToolApprovalBroker();
type WindowThemePreset = Exclude<WindowThemeMode, "system">;

async function resolveSkillRegistry(): Promise<SkillRegistry> {
  const candidates = [
    ...(app.isPackaged ? [join(process.resourcesPath, "skills")] : []),
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
function createSessionRuntime(
  snapshot: SessionSnapshot,
  skillRegistry: SkillRegistry,
  applicationDataRoot: string,
): SessionRuntime {
  const commandBus = new CommandBus(snapshot.presentation);
  const registry = createDefaultToolRegistry();
  const runtimeRoot = join(applicationDataRoot, "runtime", snapshot.session.id);
  const projectStorageIdentity = sessionStore.resolveWorkspaceRoot(snapshot)
    ?? `session:${snapshot.session.id}`;
  const projectId = asProjectId(
    sessionStore.conversationDatabase.ensureProject(
      projectStorageIdentity,
      snapshot.presentation.title,
    ),
  );
  // #region agent log
  fetch('http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4edd08'},body:JSON.stringify({sessionId:'4edd08',hypothesisId:'H1,H2,H3,H5',location:'index.ts:170',message:'createSessionRuntime resolved projectId',data:{runtimeSessionId:snapshot.session.id,sessionWorkspacePath:snapshot.session.workspacePath ?? null,projectRootPath:snapshot.project?.rootPath ?? null,projectStorageIdentity,projectId,presentationId:snapshot.presentation.id,presentationRevision:snapshot.presentation.revision},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const messageBus = new MessageBus(MessageBus.defaultMailboxDir(runtimeRoot));
  const teammateManager = new TeammateManager(messageBus);
  const presentationCommitService = new PresentationCommitService(
    snapshot.session.id,
    projectId,
    asPresentationId(snapshot.presentation.id),
    commandBus,
    sessionStore,
    presentationLifecycleOrchestrator,
    lifecycleBlobStore,
  );
  const agentService = new AgentService(
    commandBus,
    new AgentRuntime(
      registry,
      agentGateway,
      skillRegistry,
      sessionStore.conversationDatabase,
      ({ queryId, options }) => {
        if (options.runId) {
          sessionStore.conversationDatabase.bindRunQueryId(
            options.runId,
            queryId,
          );
        }
        return new PresentationLifecycleToolBridge(
          presentationLifecycleOrchestrator,
          projectId,
          snapshot.presentation.id,
          queryId,
          options.request,
          lifecycleBlobStore,
          lifecycleArtifactChangeObserver,
          options.startMode.type === "resume_query",
        );
      },
    ),
    new CommitGate(new RiskPolicy()),
    snapshot.project?.rootPath,
    toolApprovalBroker,
    messageBus,
    teammateManager,
    sessionStore.conversationDatabase,
    runtimeRoot,
    presentationLifecycleOrchestrator,
    presentationCommitService,
    lifecycleBlobStore,
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

function createAgentStreamEmitter(
  sender: WebContents,
  sessionId: string,
  runId: string,
  threadId: string,
  controller: AbortController,
): (streamEvent: AgentServiceEvent) => void {
  const abortRun = (reason: string) => {
    if (controller.signal.aborted) return;
    controller.abort();
    toolApprovalBroker.cancelForRun(runId);
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
    sessionStore.conversationDatabase.appendEvent({
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
      void sessionStore.refreshAgentRunTrace(sessionId, runId).catch((error) => {
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
  // 应用菜单已被移除，默认的开发者工具快捷键随之失效，这里手动补回。
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const toggleDevTools =
      input.key === "F12"
      || (input.control && input.shift && input.key.toLowerCase() === "i");
    if (!toggleDevTools) return;
    event.preventDefault();
    window.webContents.toggleDevTools();
  });
  const openInSystemBrowser = (rawUrl: string) => {
    const externalUrl = resolveExternalHttpUrl(rawUrl);
    if (!externalUrl) return;
    void shell.openExternal(externalUrl).catch((error) => {
      logger.warn("renderer.external-link.open-failed", { externalUrl, error });
    });
  };
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openInSystemBrowser(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openInSystemBrowser(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // #region agent log
  debugLog("H5", "index.ts:createWindow", "main window created with initial chrome", {
    windowId: window.id,
    activeWindowThemeMode,
    resolvedPreset: resolveWindowThemeMode(),
    initialOverlay: getWindowTitleBarOverlay(),
    initialBackgroundColor: getWindowBackgroundColor(),
    nativeThemeSource: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    totalWindows: BrowserWindow.getAllWindows().length,
  });
  // #endregion
  onWindowCreated?.(window);
  return window;
}

let sessionStore: FileSessionStore;
let tokenUsageStore: TokenUsageStore;
let presentationLifecycleRepository: PresentationLifecycleRepository;
let presentationLifecycleOrchestrator: PresentationLifecycleOrchestrator;
let lifecycleBlobStore: ContentAddressedBlobStore;
let lifecycleArtifactChangeObserver: PresentationArtifactChangeObserver;

let activeWindowThemeMode: WindowThemeMode = "dark";

const WINDOW_FRAME_BY_THEME: Record<WindowThemePreset, { background: string; symbol: string; nativeTheme: "light" | "dark" }> = {
  light: {
    background: "#e8eaed",
    symbol: "#0f1217",
    nativeTheme: "light",
  },
  dark: {
    background: "#181818",
    symbol: "#ffffff",
    nativeTheme: "dark",
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

// #region agent log
function debugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  fetch("http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6f9302",
    },
    body: JSON.stringify({
      sessionId: "6f9302",
      runId: "titlebar-overlay-theme",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}

debugLog("H0", "index.ts:module-load", "instrumented main process module loaded", {
  pid: process.pid,
  execPath: process.execPath,
  rendererUrl: process.env.ELECTRON_RENDERER_URL ?? null,
});
// #endregion

function resolveWindowThemeMode(themeMode: WindowThemeMode = activeWindowThemeMode): WindowThemePreset {
  if (themeMode === "system") {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }
  return themeMode;
}

function normalizeWindowThemeMode(themeMode: unknown): WindowThemeMode {
  if (themeMode === "light" || themeMode === "dark" || themeMode === "system") {
    return themeMode;
  }
  /* Legacy cyan/orange theme modes map to light chrome. */
  if (themeMode === "cyan" || themeMode === "orange") {
    return "light";
  }
  return "dark";
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
    // #region agent log
    let overlayError: string | null = null;
    try {
      browserWindow.setBackgroundColor(backgroundColor);
      browserWindow.setTitleBarOverlay(titleBarOverlay);
    } catch (error) {
      overlayError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    debugLog("H3|H4", "index.ts:applyWindowBackgroundColor", "applied window chrome", {
      windowId: browserWindow.id,
      isDestroyed: browserWindow.isDestroyed(),
      isVisible: browserWindow.isDestroyed() ? null : browserWindow.isVisible(),
      title: browserWindow.isDestroyed() ? null : browserWindow.getTitle(),
      backgroundColor,
      overlayColor: titleBarOverlay.color,
      overlaySymbolColor: titleBarOverlay.symbolColor,
      overlayError,
      totalWindows: BrowserWindow.getAllWindows().length,
    });
    if (overlayError) throw new Error(overlayError);
    // #endregion
  }
}

function applyWindowThemeMode(themeMode: WindowThemeMode): "light" | "dark" {
  // #region agent log
  debugLog("H1|H2", "index.ts:applyWindowThemeMode", "theme mode request received", {
    requestedThemeMode: themeMode,
    previousActiveThemeMode: activeWindowThemeMode,
    themeSourceBefore: nativeTheme.themeSource,
    shouldUseDarkColorsBefore: nativeTheme.shouldUseDarkColors,
  });
  // #endregion
  activeWindowThemeMode = themeMode;
  const resolvedMode = resolveWindowThemeMode(themeMode);
  nativeTheme.themeSource = WINDOW_FRAME_BY_THEME[resolvedMode].nativeTheme;
  const resolvedTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  // #region agent log
  debugLog("H2", "index.ts:applyWindowThemeMode", "theme mode resolved", {
    requestedThemeMode: themeMode,
    resolvedPreset: resolvedMode,
    themeSourceAfter: nativeTheme.themeSource,
    resolvedTheme,
    overlay: WINDOW_FRAME_BY_THEME[resolvedMode],
  });
  // #endregion
  applyWindowBackgroundColor();

  return resolvedTheme;
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.agent-ppt.app");
  }

  Menu.setApplicationMenu(null);
  await initializeLogManager();
  logger.info("application.started", {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });
  sessionStore = new FileSessionStore(join(applicationDataRoot, "conversations.sqlite"));
  await sessionStore.initialize();
  presentationLifecycleRepository = new PresentationLifecycleRepository(
    {
      filePath: join(applicationDataRoot, "conversations.sqlite"),
      connection: sessionStore.conversationDatabase.sqliteConnection,
    },
  );
  presentationLifecycleOrchestrator = new PresentationLifecycleOrchestrator(
    presentationLifecycleRepository,
  );
  lifecycleArtifactChangeObserver = new PresentationArtifactChangeObserver(
    presentationLifecycleOrchestrator,
  );
  sessionStore.setArtifactChangeObserver(lifecycleArtifactChangeObserver);
  lifecycleBlobStore = new ContentAddressedBlobStore(
    join(applicationDataRoot, "blobs"),
  );
  presentationLifecycleOrchestrator.subscribe((projection: PptJobProjection) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send("ppt-job:changed", projection);
      }
    }
  });
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
    // #region agent log
    fetch('http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4edd08'},body:JSON.stringify({sessionId:'4edd08',hypothesisId:'H3,H5',location:'index.ts:621',message:'ensureRuntime cache decision',data:{requestedSessionId:snapshot.session.id,cacheHit:Boolean(existing),cachedWorkspaceRoot:existing?.workspaceRoot ?? null,snapshotProjectRootPath:snapshot.project?.rootPath ?? null,cachedProjectId:existing?.projectId ?? null,reused:Boolean(existing)&&existing?.workspaceRoot===snapshot.project?.rootPath},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (existing && existing.workspaceRoot === snapshot.project?.rootPath) return existing;
    const runtimeRoot = join(applicationDataRoot, "runtime", snapshot.session.id);
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

  const ensureCurrentPresentationRevision = async (runtime: SessionRuntime) => {
    const presentation = runtime.commandBus.getSnapshot();
    const presentationId = asPresentationId(presentation.id);
    const existing = presentationLifecycleOrchestrator.getState(presentationId);
    if (
      existing?.presentationRevisionId
      && existing.presentationRevisionNumber === presentation.revision
    ) {
      return existing;
    }
    const registration = presentationLifecycleOrchestrator.beginCapability({
      projectId: runtime.projectId,
      presentationId,
      capability: "edit",
      instruction: "Register the current authoritative Presentation revision.",
      basePresentationRevisionId: existing?.presentationRevisionId,
    });
    const presentationBlob = await lifecycleBlobStore.put(
      Buffer.from(canonicalJson(presentation), "utf8"),
      "application/vnd.agent-ppt.presentation+json",
    );
    return presentationLifecycleOrchestrator.completePresentation({
      jobId: registration.jobId,
      presentationBlob,
      presentationRevisionNumber: presentation.revision,
    });
  };

  const initialBootstrap = sessionStore.getBootstrap();
  if (initialBootstrap.activeSession) {
    await ensureRuntime(initialBootstrap.activeSession);
  }

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
          sessionStore.conversationDatabase.finishRun({
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
          await sessionStore.finalizeAgentRunMessage(sessionId, runId, result);
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
          sessionStore.conversationDatabase.finishRun({
            runId,
            status: interrupted ? "interrupted" : "failed",
            error: message,
            result,
          });
          await sessionStore.finalizeAgentRunMessage(sessionId, runId, result);
        }
        logger.error("session.operation.failed", {
          durationMs: Date.now() - startedAt,
          error,
        });
        if (runId) return result;
        throw error;
      } finally {
        await tokenUsageStore.recordTask(
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
  ipcMain.handle("app:get-data-path", () => getApplicationDataRoot());
  ipcMain.handle("app:open-data-directory", async () => {
    const directory = getApplicationDataRoot();
    mkdirSync(directory, { recursive: true });
    const errorMessage = await shell.openPath(directory);
    if (errorMessage) {
      logger.warn("app.data-directory.open-failed", { directory, errorMessage });
      return false;
    }
    return true;
  });
  ipcMain.handle("ui-themes:list", () => listUiThemes());
  ipcMain.handle("ui-themes:read", (_event, themeId: unknown) => {
    if (typeof themeId !== "string") return null;
    return readUiThemeCss(themeId);
  });
  ipcMain.handle("ui-themes:open-directory", async () => {
    const directory = ensureUiThemesDirectory();
    const errorMessage = await shell.openPath(directory);
    if (errorMessage) {
      logger.warn("ui-themes.directory.open-failed", { directory, errorMessage });
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
    "session:save-display-cards",
    (_, sessionId: string, cards: PersistedDisplayCard[]) =>
      sessionStore.saveDisplayCards(sessionId, cards),
  );
  ipcMain.handle("ppt-job:get", (_, sessionId: string) => {
    const snapshot = sessionStore.getSession(sessionId);
    return presentationLifecycleRepository.getProjectionByPresentationId(
      asPresentationId(snapshot.presentation.id),
    );
  });

  ipcMain.handle("project:list-artifacts", (_, sessionId: string) =>
    sessionStore.listProjectArtifacts(sessionId),
  );
  ipcMain.handle(
    "project:read-artifact",
    (_, rawSessionId: unknown, rawArtifactIdOrPath: unknown) => {
      const request = projectFileOpenRequestSchema.parse({
        sessionId: rawSessionId,
        relativePath: rawArtifactIdOrPath,
      });
      return sessionStore.readProjectArtifact(request.sessionId, request.relativePath);
    },
  );
  ipcMain.handle(
    "project:get-artifact-diff",
    (
      _,
      rawSessionId: unknown,
      rawRelativePath: unknown,
      rawNextContent: unknown,
    ) => {
      const request = projectArtifactDiffRequestSchema.parse({
        sessionId: rawSessionId,
        relativePath: rawRelativePath,
        nextContent: rawNextContent,
      });
      return sessionStore.getProjectArtifactDiff(
        request.sessionId,
        request.relativePath,
        request.nextContent,
      );
    },
  );
  ipcMain.handle("project:list-files", (_, rawSessionId: unknown) =>
    sessionStore.listProjectFiles(projectFileSessionIdSchema.parse(rawSessionId)),
  );
  ipcMain.handle(
    "project:open-file",
    (_, rawSessionId: unknown, rawRelativePath: unknown) => {
      const request = projectFileOpenRequestSchema.parse({
        sessionId: rawSessionId,
        relativePath: rawRelativePath,
      });
      return sessionStore.openProjectFile(request.sessionId, request.relativePath);
    },
  );
  ipcMain.handle(
    "project:save-file",
    (
      _,
      rawSessionId: unknown,
      rawRelativePath: unknown,
      rawContent: unknown,
      rawEditToken: unknown,
      rawExpectedVersion: unknown,
    ) => {
      const request = projectFileSaveRequestSchema.parse({
        sessionId: rawSessionId,
        relativePath: rawRelativePath,
        content: rawContent,
        editToken: rawEditToken,
        expectedVersion: rawExpectedVersion,
      });
      return sessionStore.saveProjectFile(
        request.sessionId,
        request.relativePath,
        request.content,
        request.editToken,
        request.expectedVersion,
      );
    },
  );
  ipcMain.handle("presentation:get", async () =>
    (await getActiveRuntime()).commandBus.getSnapshot(),
  );
  ipcMain.handle(
    "presentation:export",
    async (_, sessionId: string, options: ExportPresentationOptions) => {
      const startedAt = Date.now();
      const validatedOptions = exportPresentationOptionsSchema.parse(options);
      const runtime = await getRuntimeForSession(sessionId);
      const presentation = runtime.commandBus.getSnapshot();
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

      const format = extname(filePath).slice(1).toLowerCase();
      if (format !== "pptx" && format !== "html" && format !== "json") {
        throw new Error("Unsupported export format.");
      }
      // #region agent log
      fetch('http://127.0.0.1:7758/ingest/f715bfbd-c4b3-4d7c-91d3-b40633f1a70c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4edd08'},body:JSON.stringify({sessionId:'4edd08',hypothesisId:'H2,H3,H5',location:'index.ts:1056',message:'export handler runtime identity',data:{requestedSessionId:sessionId,activeSessionId,runtimeProjectId:runtime.projectId,runtimeWorkspaceRoot:runtime.workspaceRoot ?? null,presentationId:presentation.id,presentationRevision:presentation.revision,format},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const presentationState = await ensureCurrentPresentationRevision(runtime);
      const exportState = presentationLifecycleOrchestrator.beginCapability({
        projectId: runtime.projectId,
        presentationId: asPresentationId(presentation.id),
        capability: "export",
        instruction: `Export the current Presentation as ${format}.`,
        basePresentationRevisionId: presentationState.presentationRevisionId,
      });
      if (!presentationState.presentationRevisionId) {
        throw new Error("Current PresentationRevision is unavailable for export.");
      }
      const destination = resolve(filePath);
      const effectKey = hashArtifactValue({
        presentationRevisionId: presentationState.presentationRevisionId,
        options: validatedOptions,
        destination,
      });
      let claimed = false;
      let lifecycleCompleted = false;

      logger.info("presentation.export.started", {
        sessionId,
        revision: presentation.revision,
        slideCount: presentation.slides.length,
        format,
      });
      try {
        const claim = presentationLifecycleRepository.claimSideEffect({
          jobId: exportState.jobId,
          operation: "export",
          key: effectKey,
          claimedAt: new Date().toISOString(),
        });
        let recoveredExport: Awaited<
          ReturnType<typeof recoverInterruptedExport>
        > | undefined;
        if (claim.type === "in_progress") {
          recoveredExport = await recoverInterruptedExport({
            lifecycle: presentationLifecycleOrchestrator,
            jobId: exportState.jobId,
            effectKey,
            presentationRevisionId:
              presentationState.presentationRevisionId,
            presentation,
            options: validatedOptions,
            destination,
            format,
          });
          lifecycleCompleted = true;
        }
        if (claim.type === "failed") {
          presentationLifecycleOrchestrator.waitForUser(
            exportState.jobId,
            "The previous export attempt failed and cannot be blindly replayed.",
          );
          throw new Error(
            `This export attempt will not be replayed: ${claim.error}`,
          );
        }
        claimed = claim.type === "claimed";

        let exportedPath = destination;
        let exportedSlideCount = presentation.slides.length;
        if (claim.type === "succeeded") {
          const settled = claim.result as {
            destination?: unknown;
            fileHash?: unknown;
            byteLength?: unknown;
            format?: unknown;
          };
          if (
            settled.destination !== destination
            || typeof settled.fileHash !== "string"
            || settled.format !== format
          ) {
            presentationLifecycleOrchestrator.waitForUser(
              exportState.jobId,
              "The recorded export proof does not match this request.",
            );
            throw new Error("The recorded export proof does not match this request.");
          }
          const existingBytes = await readFile(destination);
          if (
            hashBytes(existingBytes) !== settled.fileHash
            || existingBytes.byteLength !== settled.byteLength
          ) {
            presentationLifecycleOrchestrator.waitForUser(
              exportState.jobId,
              "The exported file no longer matches its durable hash.",
            );
            throw new Error("The exported file no longer matches its durable hash.");
          }
        } else if (claim.type === "claimed") {
          const result = await deckExportService.exportDeck({
            presentation,
            options: validatedOptions,
            filePath: destination,
            workspaceRoot: runtime.workspaceRoot,
          });
          exportedPath = result.filePath;
          exportedSlideCount = result.slideCount;
        } else {
          exportedSlideCount = recoveredExport!.proof.slideCount;
        }
        if (!recoveredExport) {
          const exportedBytes = await readFile(exportedPath);
          const exportedStat = await stat(exportedPath);
          const fileHash = hashBytes(exportedBytes);
          presentationLifecycleOrchestrator.completeExport({
            jobId: exportState.jobId,
            effectKey,
            presentationRevisionId: presentationState.presentationRevisionId,
            options: validatedOptions,
            destination: exportedPath,
            format,
            fileHash,
            byteLength: exportedStat.size,
            postflight: {
              passed: true,
              validator: "export-service",
              slideCount: exportedSlideCount,
            },
          });
          lifecycleCompleted = true;
        }

        if (format === "pptx") {
          await sessionStore.recordDeckExport(sessionId, {
            revision: presentation.revision,
            filePath: exportedPath,
            designSystem: presentation.designSystem,
          }).catch((error) => {
            logger.error("presentation.export-history.sync-failed", {
              sessionId,
              filePath: exportedPath,
              error,
            });
          });
        }

        logger.info("presentation.export.completed", {
          sessionId,
          filePath: exportedPath,
          durationMs: Date.now() - startedAt,
        });
        return exportedPath;
      } catch (error) {
        if (claimed && !lifecycleCompleted) {
          presentationLifecycleRepository.completeSideEffect({
            jobId: exportState.jobId,
            operation: "export",
            key: effectKey,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            completedAt: new Date().toISOString(),
          });
          const latest = presentationLifecycleRepository.getJob(exportState.jobId);
          if (
            latest?.currentRequest.requestId === exportState.currentRequest.requestId
            && latest.status === "running"
          ) {
            presentationLifecycleOrchestrator.waitForUser(
              exportState.jobId,
              "Export failed; choose whether to retry with a new destination.",
            );
          }
        }
        logger.error("presentation.export.failed", {
          sessionId,
          filePath: destination,
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
    async (_, runId: string, approvalId: string, approved: boolean) => {
      const resolved = toolApprovalBroker.resolve(approvalId, approved);
      withLogContext({ runId }, () => {
        logger.info("agent.tool-approval.resolved", {
          approvalId,
          approved,
          resolved,
        });
      });
      return resolved;
    },
  );

  ipcMain.handle("agent:poll-lead-inbox", async (_, sessionId: string) => {
    const runtime = await getRuntimeForSession(sessionId);
    const messages = runtime.messageBus
      ? await runtime.messageBus.peekInbox("lead")
      : [];
    return {
      hasMessages: messages.length > 0,
      count: messages.length,
      preview: formatMailboxMessagesForHistory(messages.slice(0, 5), 1_000),
      types: Array.from(new Set(messages.map((message) => message.type))),
    };
  });

  /**
   * 接收 Renderer 的新 query，完成协议/模型配置校验、并发控制和运行事件初始化，
   * 并统一进入 Agent 的 SVG-native 工具循环。旧 Lean 请求在入口处明确拒绝。
   */
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
      const request = parseAgentRequest("start", rawRequest);
      const sessionId = request.sessionId;
      const currentRunId = runId || crypto.randomUUID();

      // 当前桌面端采用单窗口、单前台运行模型；Main 同步执行这一约束，
      // 让模型配置和交互状态在一次 run 内保持稳定。
      if (activeRuns.size > 0) {
        withLogContext({ operation: "start", sessionId, runId: currentRunId, threadId: currentRunId }, () => {
          logger.warn("agent.request.rejected", {
            reason: "concurrency-conflict",
            activeRunIds: [...activeRuns.keys()],
            ...requestSummary(request.prompt),
          });
        });
        throw new Error("Concurrency Conflict: An active agent run is already in progress.");
      }

      const controller = new AbortController();
      activeRuns.set(currentRunId, controller);
      sessionActiveRuns.set(sessionId, currentRunId);

      try {
        const runtime = await getRuntimeForSession(sessionId);
        const settings = input ? agentModelSettingsSchema.parse(input) : undefined;
        const executionStrategy = strategy
          ? agentExecutionStrategySchema.parse(strategy)
          : "REQUEST_APPROVAL";
        const agentStepLimits = rawStepLimits
          ? agentStepLimitsSchema.parse(rawStepLimits)
          : undefined;
        const services = rawGatewayConfig
          ? splitAgentRunServicesConfig(agentRunServicesWireSchema.parse(rawGatewayConfig))
          : undefined;
        let selection: AgentModelSelection | undefined;
        if (settings) {
          selection = agentGateway.configure(settings, services?.gateway, services?.search);
        } else if (services) {
          agentGateway.applyGatewayConfig(services.gateway);
          agentGateway.applySearchConfig(services.search);
        }
        sessionStore.conversationDatabase.beginRun({
          runId: currentRunId,
          sessionId,
          threadId: currentRunId,
          provider: selection?.provider,
          model: selection?.model,
          request: request.prompt,
        });
        const emit = createAgentStreamEmitter(
          event.sender,
          sessionId,
          currentRunId,
          currentRunId,
          controller,
        );

        const result = await runAgentOperation(
          "start",
          sessionId,
          currentRunId,
          request.prompt,
          {
            threadId: currentRunId,
            provider: selection?.provider,
            model: selection?.model,
            executionStrategy,
          },
          controller.signal,
          async () => {
            const result = await runtime.agentService.start(
              request.prompt,
              selection,
              executionStrategy,
              emit,
              request.editorContext,
              sessionStore.getAgentMessageHistory(sessionId, request.prompt),
              controller.signal,
              currentRunId,
              agentStepLimits,
            );
            return finalizeAgentResult(sessionId, runtime, result, currentRunId);
          },
        );
        if (!event.sender.isDestroyed()) {
          event.sender.send("agent:stream", {
            type: "stream-completed",
            runId: currentRunId,
            sessionId,
          } satisfies AgentStreamEvent);
        }
        return result;
      } finally {
        toolApprovalBroker.finishForRun(currentRunId);
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
    rawExecutionStrategy?: AgentExecutionStrategy,
    rawStepLimits?: AgentStepLimits,
    rawGatewayConfig?: AgentGatewayConfig,
    runId?: string,
  ) => {
    const request = parseAgentRequest("continue-agent-run", rawRequest);
    const sessionId = request.sessionId;
    const currentRunId = runId || crypto.randomUUID();

    // 与 start 保持同一条全局串行边界，避免继续会话与新运行交错。
    if (activeRuns.size > 0) {
      withLogContext({ operation: "continue-agent-run", sessionId, runId: currentRunId, threadId }, () => {
        logger.warn("agent.request.rejected", {
          reason: "concurrency-conflict",
          activeRunIds: [...activeRuns.keys()],
          ...requestSummary(request.prompt),
        });
      });
      throw new Error("Concurrency Conflict: An active agent run is already in progress.");
    }

    const controller = new AbortController();
    activeRuns.set(currentRunId, controller);
    sessionActiveRuns.set(sessionId, currentRunId);

    try {
      const runtime = await getRuntimeForSession(sessionId);
      const settings = rawModelSettings
        ? agentModelSettingsSchema.parse(rawModelSettings)
        : undefined;
      const executionStrategy = rawExecutionStrategy
        ? agentExecutionStrategySchema.parse(rawExecutionStrategy)
        : undefined;
      const agentStepLimits = rawStepLimits
        ? agentStepLimitsSchema.parse(rawStepLimits)
        : undefined;
      const services = rawGatewayConfig
        ? splitAgentRunServicesConfig(agentRunServicesWireSchema.parse(rawGatewayConfig))
        : undefined;
      let selection: AgentModelSelection | undefined;
      if (settings) {
        selection = agentGateway.configure(settings, services?.gateway, services?.search);
      } else if (services) {
        agentGateway.applyGatewayConfig(services.gateway);
        agentGateway.applySearchConfig(services.search);
      }
      sessionStore.conversationDatabase.beginRun({
        runId: currentRunId,
        sessionId,
        threadId,
        provider: selection?.provider,
        model: selection?.model,
        request: request.prompt,
      });
      const emit = createAgentStreamEmitter(
        event.sender,
        sessionId,
        currentRunId,
        threadId,
        controller,
      );

      const result = await runAgentOperation(
        "continue-agent-run",
        sessionId,
        currentRunId,
        request.prompt,
        { threadId },
        controller.signal,
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
                selection,
                executionStrategy,
              )
            : runtime.agentService.start(
                request.prompt,
                selection,
                executionStrategy ?? "REQUEST_APPROVAL",
                emit,
                request.editorContext,
                sessionStore.getAgentMessageHistory(sessionId, request.prompt),
                controller.signal,
                currentRunId,
                agentStepLimits,
              );

          return finalizeAgentResult(sessionId, runtime, await run, currentRunId);
        },
      );
      if (!event.sender.isDestroyed()) {
        event.sender.send("agent:stream", {
          type: "stream-completed",
          runId: currentRunId,
          sessionId,
        } satisfies AgentStreamEvent);
      }
      return result;
    } finally {
      toolApprovalBroker.finishForRun(currentRunId);
      activeRuns.delete(currentRunId);
      if (sessionActiveRuns.get(sessionId) === currentRunId) {
        sessionActiveRuns.delete(sessionId);
      }
    }
  });

  ipcMain.handle("agent:resume", async (
    _event,
    sessionId: string,
    rawProposalId: string,
    approved: boolean,
  ) => {
    const proposalId = asProposalId(rawProposalId);
    const runtime = await getRuntimeForSession(sessionId);
    const chat = sessionStore.findProposalChatContext(sessionId, proposalId);
    withLogContext({
      operation: "resolve-proposal",
      sessionId,
      threadId: chat?.threadId,
    }, () => {
      logger.info("agent.proposal.resolution.received", { proposalId, approved });
    });
    return runAgentOperation(
      "resolve-proposal",
      sessionId,
      undefined,
      undefined,
      {
        proposalId,
        ...(chat?.threadId ? { threadId: chat.threadId } : {}),
        approved,
      },
      undefined,
      async () => finalizeAgentResult(
        sessionId,
        runtime,
        await runtime.agentService.resumeProposal(proposalId, approved),
        undefined,
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
  presentationLifecycleRepository?.close();
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
