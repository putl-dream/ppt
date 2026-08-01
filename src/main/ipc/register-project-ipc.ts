import { ipcMain } from "electron";
import {
  projectArtifactDiffRequestSchema,
  projectFileOpenRequestSchema,
  projectFileSaveRequestSchema,
  projectFileSessionIdSchema,
} from "@shared/ipc";
import type { AppContext } from "../app-context";

export function registerProjectIpc(ctx: AppContext): void {
  ipcMain.handle("project:list-artifacts", (_, sessionId: string) =>
    ctx.sessionStore.listProjectArtifacts(sessionId),
  );
  ipcMain.handle(
    "project:read-artifact",
    (_, rawSessionId: unknown, rawArtifactIdOrPath: unknown) => {
      const request = projectFileOpenRequestSchema.parse({
        sessionId: rawSessionId,
        relativePath: rawArtifactIdOrPath,
      });
      return ctx.sessionStore.readProjectArtifact(request.sessionId, request.relativePath);
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
      return ctx.sessionStore.getProjectArtifactDiff(
        request.sessionId,
        request.relativePath,
        request.nextContent,
      );
    },
  );
  ipcMain.handle("project:list-files", (_, rawSessionId: unknown) =>
    ctx.sessionStore.listProjectFiles(projectFileSessionIdSchema.parse(rawSessionId)),
  );
  ipcMain.handle(
    "project:open-file",
    (_, rawSessionId: unknown, rawRelativePath: unknown) => {
      const request = projectFileOpenRequestSchema.parse({
        sessionId: rawSessionId,
        relativePath: rawRelativePath,
      });
      return ctx.sessionStore.openProjectFile(request.sessionId, request.relativePath);
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
      return ctx.sessionStore.saveProjectFile(
        request.sessionId,
        request.relativePath,
        request.content,
        request.editToken,
        request.expectedVersion,
      );
    },
  );
}
