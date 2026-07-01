import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Presentation } from "@shared/presentation";
import type { DeckExportResult, ExportPresentationOptions } from "@shared/ipc";
import { exportToPptx } from "../ppt-exporter";

export interface DeckExportInput {
  presentation: Presentation;
  options: ExportPresentationOptions;
  filePath?: string;
}

function sanitizeFileName(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "presentation";
}

function resolveExportOptions(
  presentation: Presentation,
  options: ExportPresentationOptions,
): ExportPresentationOptions {
  return {
    theme: presentation.theme ?? options.theme,
    palette: presentation.palette ?? options.palette,
    logoUrl: options.logoUrl,
  };
}

/**
 * 文件层导出服务：Presentation → .pptx（或 JSON 镜像）。
 * 与数据生成（CommandBus / revision）解耦，同一 revision 可多次导出。
 */
export class DeckExportService {
  async exportDeck(input: DeckExportInput): Promise<DeckExportResult> {
    const mergedOptions = resolveExportOptions(input.presentation, input.options);
    const filePath =
      input.filePath ??
      (await this.createDefaultExportPath(input.presentation, "pptx"));

    if (filePath.endsWith(".json")) {
      await writeFile(filePath, JSON.stringify(input.presentation, null, 2), "utf8");
    } else {
      if (!filePath.endsWith(".pptx")) {
        throw new Error("Unsupported export format; only .pptx and .json are supported.");
      }
      await exportToPptx(input.presentation, mergedOptions, filePath);
    }

    return {
      filePath,
      slideCount: input.presentation.slides.length,
    };
  }

  private async createDefaultExportPath(
    presentation: Presentation,
    format: "pptx" | "json",
  ): Promise<string> {
    const dir = join(tmpdir(), "agent-ppt-exports");
    await mkdir(dir, { recursive: true });
    const base = sanitizeFileName(presentation.title || "presentation");
    return join(dir, `${base}-${Date.now()}.${format}`);
  }
}

export const deckExportService = new DeckExportService();
