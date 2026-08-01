import { mkdirSync } from "node:fs";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { AppLogLevel, LogManagerSettings, RendererLogReport } from "@shared/logging";
import {
  clearLogFiles,
  createModuleLogger,
  getLogDirectory,
  getLogManagerStatus,
  getRecentLogEntries,
  updateLogManagerSettings,
} from "../agent/logger";
import { getApplicationDataRoot } from "../application-data";
import type { AppContext } from "../app-context";
import {
  applyWindowThemeMode,
  normalizeWindowThemeMode,
} from "../window/theme";

const logger = createModuleLogger("main");

export function registerLogsAppIpc(ctx: AppContext): void {
  ipcMain.handle("token-usage:get-stats", () => ctx.tokenUsageStore.getStats());
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
  ipcMain.on("logs:renderer-report", (_event, report: RendererLogReport) => {
    if (!report || !["debug", "info", "warn", "error"].includes(report.level)) return;
    if (typeof report.event !== "string" || !report.event.trim()) return;
    logger[report.level](`renderer.${report.event}`, report.data);
  });
  ipcMain.handle("window:set-theme-mode", (_event, themeMode: unknown) =>
    applyWindowThemeMode(normalizeWindowThemeMode(themeMode)),
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
}
