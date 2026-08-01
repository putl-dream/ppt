import { ipcMain } from "electron";
import type { PresentationCommand } from "@shared/commands";
import type { ExportPresentationOptions } from "@shared/ipc";
import type { AppContext } from "../app-context";
import { exportPresentationForSession } from "../deck/export-presentation-for-session";
import type { SessionRuntimeRegistry } from "../session-runtime";

export function registerPresentationIpc(
  ctx: AppContext,
  registry: SessionRuntimeRegistry,
): void {
  ipcMain.handle("presentation:get", async () =>
    (await registry.getActiveRuntime()).commandBus.getSnapshot(),
  );
  ipcMain.handle("presentation:undo", async () => {
    const runtime = await registry.getActiveRuntime();
    return runtime.presentationCommitService.undo();
  });
  ipcMain.handle("presentation:redo", async () => {
    const runtime = await registry.getActiveRuntime();
    return runtime.presentationCommitService.redo();
  });
  ipcMain.handle("presentation:execute", async (_, command: PresentationCommand) => {
    const runtime = await registry.getActiveRuntime();
    return runtime.presentationCommitService.execute(command);
  });
  ipcMain.handle(
    "presentation:export",
    async (_, sessionId: string, options: ExportPresentationOptions) =>
      exportPresentationForSession(ctx, registry, sessionId, options),
  );
}
