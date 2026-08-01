import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { BrowserWindow, dialog } from "electron";
import {
  exportPresentationOptionsSchema,
  type ExportPresentationOptions,
} from "@shared/ipc";
import { asPresentationId } from "@shared/presentation-lifecycle";
import { createModuleLogger } from "../agent/logger";
import type { AppContext } from "../app-context";
import type { SessionRuntimeRegistry } from "../session-runtime";
import {
  hashArtifactValue,
  hashBytes,
} from "../presentation-lifecycle/content-addressed-blob-store";
import { deckExportService } from "./deck-export-service";
import { recoverInterruptedExport } from "./export-recovery";

const logger = createModuleLogger("main");

export async function exportPresentationForSession(
  ctx: AppContext,
  registry: SessionRuntimeRegistry,
  sessionId: string,
  options: ExportPresentationOptions,
): Promise<string | null> {
  const startedAt = Date.now();
  const validatedOptions = exportPresentationOptionsSchema.parse(options);
  const runtime = await registry.getRuntimeForSession(sessionId);
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
  const presentationState = await registry.ensureCurrentPresentationRevision(runtime);
  const exportState = ctx.presentationLifecycleOrchestrator.beginCapability({
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
    const claim = ctx.presentationLifecycleRepository.claimSideEffect({
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
        lifecycle: ctx.presentationLifecycleOrchestrator,
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
      ctx.presentationLifecycleOrchestrator.waitForUser(
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
        ctx.presentationLifecycleOrchestrator.waitForUser(
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
        ctx.presentationLifecycleOrchestrator.waitForUser(
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
      ctx.presentationLifecycleOrchestrator.completeExport({
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
      await ctx.sessionStore.recordDeckExport(sessionId, {
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
      ctx.presentationLifecycleRepository.completeSideEffect({
        jobId: exportState.jobId,
        operation: "export",
        key: effectKey,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      });
      const latest = ctx.presentationLifecycleRepository.getJob(exportState.jobId);
      if (
        latest?.currentRequest.requestId === exportState.currentRequest.requestId
        && latest.status === "running"
      ) {
        ctx.presentationLifecycleOrchestrator.waitForUser(
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
}
