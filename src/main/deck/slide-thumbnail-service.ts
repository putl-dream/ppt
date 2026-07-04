import { BrowserWindow } from "electron";
import type { Slide } from "@shared/presentation";
import {
  exportSlideThumbnailHtml,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
} from "@shared/slide-html-render";

export interface SlideThumbnailResult {
  pngBase64: string;
  width: number;
  height: number;
  mimeType: "image/png";
}

function isElectronRuntime(): boolean {
  return typeof process !== "undefined" && !!process.versions?.electron;
}

/**
 * Renders a slide to PNG via hidden BrowserWindow + capturePage.
 * Returns null outside Electron (e.g. vitest).
 */
export class SlideThumbnailService {
  private captureWindow: BrowserWindow | null = null;

  async captureSlide(
    slide: Slide,
    theme: string,
    palette: string,
  ): Promise<SlideThumbnailResult | null> {
    if (!isElectronRuntime()) return null;

    const html = exportSlideThumbnailHtml(slide, { theme, palette });
    const window = await this.ensureWindow();

    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await this.waitForRender(window);

    const image = await window.webContents.capturePage({
      x: 0,
      y: 0,
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
    });

    const resized = image.resize({
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      quality: "best",
    });

    return {
      pngBase64: resized.toPNG().toString("base64"),
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      mimeType: "image/png",
    };
  }

  dispose(): void {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.destroy();
    }
    this.captureWindow = null;
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      return this.captureWindow;
    }

    this.captureWindow = new BrowserWindow({
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      show: false,
      frame: false,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        sandbox: true,
      },
    });

    return this.captureWindow;
  }

  private waitForRender(window: BrowserWindow): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, 3000);

      const cleanup = () => {
        clearTimeout(timeout);
        window.webContents.removeListener("did-finish-load", onLoad);
        window.webContents.removeListener("did-fail-load", onFail);
      };

      const onLoad = () => {
        cleanup();
        // Allow layout/fonts to settle before capture.
        setTimeout(resolve, 50);
      };

      const onFail = (_event: unknown, errorCode: number, errorDescription: string) => {
        cleanup();
        reject(new Error(`Thumbnail render failed (${errorCode}): ${errorDescription}`));
      };

      if (window.webContents.isLoading()) {
        window.webContents.once("did-finish-load", onLoad);
        window.webContents.once("did-fail-load", onFail);
      } else {
        cleanup();
        setTimeout(resolve, 50);
      }
    });
  }
}

export const slideThumbnailService = new SlideThumbnailService();
