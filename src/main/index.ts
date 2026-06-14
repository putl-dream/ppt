import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, ipcMain, Menu, dialog, type MessageBoxOptions } from "electron";
import { CommandBus, type PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import type { ExportPresentationOptions } from "@shared/ipc";
import { exportToPptx } from "./ppt-exporter";
import { AgentService, type AgentServiceEvent } from "./agent/workflow";
import {
  agentExecutionStrategySchema,
  agentModelSettingsSchema,
  type AgentExecutionStrategy,
  type AgentModelSettings,
} from "@shared/agent";
import { AgentGateway } from "./agent/gateway";
import { createModelPresentationPlanner } from "./agent/planner";
import { createModelOutlinePlanner } from "./agent/outline-planner";
import { FileSessionStore } from "./session-store";
import type { SessionChatMessage, SessionSnapshot } from "@shared/session";

const agentGateway = new AgentGateway();

interface SessionRuntime {
  commandBus: CommandBus;
  agentService: AgentService;
}

function createSessionRuntime(snapshot: SessionSnapshot): SessionRuntime {
  const commandBus = new CommandBus(snapshot.presentation);
  return {
    commandBus,
    agentService: new AgentService(
      commandBus,
      createModelPresentationPlanner(agentGateway),
      createModelOutlinePlanner(agentGateway),
    ),
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const sessionStore = new FileSessionStore(join(app.getPath("userData"), "sessions.json"));
  await sessionStore.initialize();

  const runtimes = new Map<string, SessionRuntime>();
  let activeSessionId = sessionStore.getBootstrap().activeSession.session.id;

  const ensureRuntime = (snapshot: SessionSnapshot): SessionRuntime => {
    const existing = runtimes.get(snapshot.session.id);
    if (existing) return existing;
    const runtime = createSessionRuntime(snapshot);
    runtimes.set(snapshot.session.id, runtime);
    return runtime;
  };

  const getActiveRuntime = (): SessionRuntime =>
    ensureRuntime(sessionStore.getSession(activeSessionId));

  const persistPresentation = async (sessionId: string, runtime: SessionRuntime) => {
    const presentation = runtime.commandBus.getSnapshot();
    await sessionStore.savePresentation(sessionId, presentation);
    return presentation;
  };

  ipcMain.handle("session:get-state", () => sessionStore.getBootstrap());
  ipcMain.handle("session:create", async () => {
    const state = await sessionStore.createSession();
    activeSessionId = state.activeSession.session.id;
    ensureRuntime(state.activeSession);
    return state;
  });
  ipcMain.handle("session:select", async (_, sessionId: string) => {
    const state = await sessionStore.selectSession(sessionId);
    activeSessionId = state.activeSession.session.id;
    ensureRuntime(state.activeSession);
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
    ensureRuntime(state.activeSession);
    return state;
  });
  ipcMain.handle(
    "session:save-messages",
    (_, sessionId: string, messages: SessionChatMessage[]) =>
      sessionStore.saveMessages(sessionId, messages),
  );

  ipcMain.handle("presentation:get", () => getActiveRuntime().commandBus.getSnapshot());
  ipcMain.handle("presentation:undo", async () => {
    const sessionId = activeSessionId;
    const runtime = getActiveRuntime();
    runtime.commandBus.undo();
    return persistPresentation(sessionId, runtime);
  });
  ipcMain.handle("presentation:redo", async () => {
    const sessionId = activeSessionId;
    const runtime = getActiveRuntime();
    runtime.commandBus.redo();
    return persistPresentation(sessionId, runtime);
  });
  ipcMain.handle("presentation:execute", async (_, command: PresentationCommand) => {
    const sessionId = activeSessionId;
    const runtime = getActiveRuntime();
    runtime.commandBus.execute(command);
    return persistPresentation(sessionId, runtime);
  });
  ipcMain.handle(
    "presentation:export",
    async (_, presentation: Presentation, options: ExportPresentationOptions) => {
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

      if (filePath.endsWith(".json")) {
        await writeFile(filePath, JSON.stringify(presentation, null, 2), "utf8");
      } else {
        await exportToPptx(presentation, options, filePath);
      }

      return filePath;
    },
  );
  ipcMain.handle(
    "agent:start",
    async (
      event,
      request: string,
      input?: AgentModelSettings,
      strategy?: AgentExecutionStrategy,
      runId?: string,
    ) => {
      const sessionId = activeSessionId;
      const runtime = getActiveRuntime();
      const settings = input ? agentModelSettingsSchema.parse(input) : undefined;
      const executionStrategy = strategy
        ? agentExecutionStrategySchema.parse(strategy)
        : "REQUEST_APPROVAL";
      const selection = settings ? agentGateway.configure(settings) : undefined;
      const emit = (streamEvent: AgentServiceEvent) => {
        if (runId) event.sender.send("agent:stream", { ...streamEvent, runId });
      };
      const result = await runtime.agentService.start(request, selection, executionStrategy, emit);
      if (result.status === "completed" || result.status === "rejected") {
        await persistPresentation(sessionId, runtime);
      }
      return result;
    },
  );
  ipcMain.handle("agent:continue", async (event, threadId: string, request: string, runId?: string) => {
    const sessionId = activeSessionId;
    const runtime = getActiveRuntime();
    const result = await runtime.agentService.continueOutline(threadId, request, (streamEvent) => {
      if (runId) event.sender.send("agent:stream", { ...streamEvent, runId });
    });
    if (result.status === "completed" || result.status === "rejected") {
      await persistPresentation(sessionId, runtime);
    }
    return result;
  });
  ipcMain.handle("agent:confirm-outline", async (event, threadId: string, runId?: string) => {
    const sessionId = activeSessionId;
    const runtime = getActiveRuntime();
    const result = await runtime.agentService.confirmOutline(threadId, (streamEvent) => {
      if (runId) event.sender.send("agent:stream", { ...streamEvent, runId });
    });
    if (result.status === "completed" || result.status === "rejected") {
      await persistPresentation(sessionId, runtime);
    }
    return result;
  });
  ipcMain.handle("agent:resume", async (_, threadId: string, approved: boolean) => {
    const sessionId = activeSessionId;
    const runtime = getActiveRuntime();
    const result = await runtime.agentService.resume(threadId, approved);
    await persistPresentation(sessionId, runtime);
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
