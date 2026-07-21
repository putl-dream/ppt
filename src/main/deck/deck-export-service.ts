import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { presentationSchema, type Presentation } from "@shared/presentation";
import {
  exportPresentationOptionsSchema,
  type DeckExportResult,
  type ExportPresentationOptions,
} from "@shared/ipc";
import { exportToPptx } from "../ppt-exporter";
import { exportToHtml } from "@shared/html-exporter";
import { assetValidator } from "./validators/asset-validator";
import {
  assertSupportedLocalImageFile,
  resolveLocalImagePath,
} from "../local-image-file";

export interface DeckExportInput {
  presentation: Presentation;
  options: ExportPresentationOptions;
  filePath?: string;
  format?: "pptx" | "json" | "html";
  workspaceRoot?: string;
}

function sanitizeFileName(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "presentation";
}

async function inlineHtmlImageAssets(
  presentation: Presentation,
  workspaceRoot?: string,
): Promise<Presentation> {
  for (const slide of presentation.slides) {
    for (const element of slide.elements) {
      if (element.type !== "image" || /^data:image\/(?:png|jpeg|gif);base64,/i.test(element.url)) {
        continue;
      }
      if (!workspaceRoot) {
        throw new Error(`Cannot embed local image '${element.id}' without a workspace root.`);
      }
      const imagePath = resolveLocalImagePath(element.url, workspaceRoot);
      const mimeType = await assertSupportedLocalImageFile(imagePath);
      const data = await readFile(imagePath);
      element.url = `data:${mimeType};base64,${data.toString("base64")}`;
    }
  }
  return presentation;
}

/**
 * 文件层导出服务：Presentation → .pptx（或 JSON 镜像）。
 * 与数据生成（CommandBus / revision）解耦，同一 revision 可多次导出。
 */
export class DeckExportService {
  /**
   * 从不可变 Presentation 快照导出目标格式。
   * PPTX 导出前执行 deck/素材校验，导出后执行结构 postflight，失败时不伪装为成功产物。
   */
  async exportDeck(input: DeckExportInput): Promise<DeckExportResult> {
    const presentation = presentationSchema.parse(structuredClone(input.presentation));
    const options = exportPresentationOptionsSchema.parse(input.options);
    const format = input.format ?? "pptx";
    const filePath =
      input.filePath ??
      (await this.createDefaultExportPath(presentation, format));

    if (filePath.endsWith(".json")) {
      await writeFile(filePath, JSON.stringify(presentation, null, 2), "utf8");
    } else {
      const assetErrors = assetValidator.validate(presentation, {
        workspaceRoot: input.workspaceRoot,
        allowUnverifiedAssets: options.allowUnverifiedAssets,
      }).filter((issue) => issue.severity === "error");
      if (assetErrors.length > 0) {
        throw new Error(
          `Export blocked by asset validation: ${assetErrors.map((issue) => issue.message).join("; ")}`,
        );
      }

      if (filePath.endsWith(".html")) {
        const portablePresentation = await inlineHtmlImageAssets(presentation, input.workspaceRoot);
        const html = exportToHtml(portablePresentation, options);
        await writeFile(filePath, html, "utf8");
        return {
          filePath,
          slideCount: presentation.slides.length,
        };
      }
      if (!filePath.endsWith(".pptx")) {
        throw new Error("Unsupported export format; only .pptx, .json, and .html are supported.");
      }
      await exportToPptx(presentation, options, filePath, input.workspaceRoot);
    }

    return {
      filePath,
      slideCount: presentation.slides.length,
    };
  }

  private async createDefaultExportPath(
    presentation: Presentation,
    format: "pptx" | "json" | "html",
  ): Promise<string> {
    const dir = join(tmpdir(), "agent-ppt-exports");
    await mkdir(dir, { recursive: true });
    const base = sanitizeFileName(presentation.title || "presentation");
    return join(dir, `${base}-${Date.now()}.${format}`);
  }
}

export const deckExportService = new DeckExportService();
