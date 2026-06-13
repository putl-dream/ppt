import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { CommandBus, type PresentationCommand } from "@shared/commands";
import { createStarterPresentation } from "@shared/presentation";
import { AgentService } from "./agent/workflow";
import { agentModelSettingsSchema, type AgentModelSettings } from "@shared/agent";
import { AgentGateway } from "./agent/gateway";
import { createModelPresentationPlanner } from "./agent/planner";

const commandBus = new CommandBus(createStarterPresentation());
const agentGateway = new AgentGateway();
const agentService = new AgentService(commandBus, createModelPresentationPlanner(agentGateway));

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
  window.webContents.on("console-message", (_, level, message) => {
    if (level >= 2) console.error("Renderer error:", message);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle("presentation:get", () => commandBus.getSnapshot());
  ipcMain.handle("presentation:undo", () => commandBus.undo());
  ipcMain.handle("presentation:redo", () => commandBus.redo());
  ipcMain.handle("presentation:execute", (_, command: PresentationCommand) =>
    commandBus.execute(command),
  );
  ipcMain.handle("agent:start", (_, request: string, input?: AgentModelSettings) => {
    const settings = input ? agentModelSettingsSchema.parse(input) : undefined;
    const selection = settings ? agentGateway.configure(settings) : undefined;
    return agentService.start(request, selection);
  });
  ipcMain.handle("agent:resume", (_, threadId: string, approved: boolean) =>
    agentService.resume(threadId, approved),
  );

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
