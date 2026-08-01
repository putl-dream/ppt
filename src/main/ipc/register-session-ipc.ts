import {
  BrowserWindow,
  dialog,
  ipcMain,
  type MessageBoxOptions,
} from "electron";
import type { CreateSessionOptions } from "@shared/ipc";
import type { SessionChatMessage } from "@shared/session";
import type { PersistedDisplayCard } from "@shared/card-display-protocol";
import { asPresentationId } from "@shared/presentation-lifecycle";
import { createModuleLogger } from "../agent/logger";
import type { AppContext } from "../app-context";
import type { SessionRuntimeRegistry } from "../session-runtime";

const logger = createModuleLogger("main");

export function registerSessionIpc(
  ctx: AppContext,
  registry: SessionRuntimeRegistry,
): void {
  ipcMain.handle("session:get-state", () => ctx.sessionStore.getBootstrap());

  ipcMain.handle("session:create", async (_, options?: CreateSessionOptions) => {
    const startedAt = Date.now();
    const state = await ctx.sessionStore.createSession(options);
    registry.setActiveSessionId(state.activeSession?.session.id ?? "");
    if (state.activeSession) {
      await registry.ensureRuntime(state.activeSession);
    }
    logger.info("session.created", {
      sessionId: registry.getActiveSessionId(),
      hasWorkspace: Boolean(options?.rootPath),
      durationMs: Date.now() - startedAt,
    });
    return state;
  });

  ipcMain.handle("workspace:open", async (_, rootPath: string) => {
    const startedAt = Date.now();
    const state = await ctx.sessionStore.openWorkspace(rootPath);
    registry.setActiveSessionId(state.activeSession?.session.id ?? "");
    if (state.activeSession) {
      await registry.ensureRuntime(state.activeSession);
    }
    logger.info("workspace.opened", {
      sessionId: registry.getActiveSessionId(),
      rootPath,
      durationMs: Date.now() - startedAt,
    });
    return state;
  });

  ipcMain.handle("workspace:list-sessions", async (_, rootPath: string) =>
    ctx.sessionStore.listWorkspaceSessions(rootPath),
  );

  ipcMain.handle("session:select", async (_, sessionId: string) => {
    const startedAt = Date.now();
    const state = await ctx.sessionStore.selectSession(sessionId);
    registry.setActiveSessionId(state.activeSession?.session.id ?? "");
    if (state.activeSession) {
      await registry.ensureRuntime(state.activeSession);
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
      return ctx.sessionStore.getBootstrap();
    }
    const state = await ctx.sessionStore.deleteSession(sessionId);
    registry.deleteRuntime(sessionId);
    registry.setActiveSessionId(state.activeSession?.session.id ?? "");
    if (state.activeSession) {
      await registry.ensureRuntime(state.activeSession);
    }
    logger.info("session.deleted", {
      sessionId,
      nextSessionId: registry.getActiveSessionId() || undefined,
    });
    return state;
  });

  ipcMain.handle(
    "session:save-messages",
    (_, sessionId: string, messages: SessionChatMessage[]) =>
      ctx.sessionStore.saveMessages(sessionId, messages),
  );

  ipcMain.handle(
    "session:save-display-cards",
    (_, sessionId: string, cards: PersistedDisplayCard[]) =>
      ctx.sessionStore.saveDisplayCards(sessionId, cards),
  );

  ipcMain.handle(
    "conversation:load-events",
    (_, sessionId: string, cursor?: number, limit?: number) =>
      ctx.sessionStore.conversationDatabase.listEvents(sessionId, cursor, limit),
  );

  ipcMain.handle("ppt-job:get", (_, sessionId: string) => {
    const snapshot = ctx.sessionStore.getSession(sessionId);
    return ctx.presentationLifecycleRepository.getProjectionByPresentationId(
      asPresentationId(snapshot.presentation.id),
    );
  });
}
