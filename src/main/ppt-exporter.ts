import pptxgen from "pptxgenjs";
import type { Presentation } from "@shared/presentation";
import type { ExportPresentationOptions } from "@shared/ipc";
import { createModuleLogger } from "./agent/logger";
import { utf8ToBase64 } from "@shared/base64";
import { createPptxExportIdentity } from "./deck/export-identity";

const logger = createModuleLogger("ppt-exporter");
const PPTX_LAYOUT_NAME = "AGENT_PPT_WIDE";
const PPTX_SLIDE_WIDTH_INCHES = 10;
const PPTX_SLIDE_HEIGHT_INCHES = 5.625;

export async function exportToPptx(
  presentation: Presentation,
  options: ExportPresentationOptions,
  filePath: string,
  _workspaceRoot?: string,
): Promise<void> {
  const pptx = new pptxgen();
  pptx.subject = createPptxExportIdentity(presentation, options);
  pptx.title = presentation.title;
  pptx.defineLayout({
    name: PPTX_LAYOUT_NAME,
    width: PPTX_SLIDE_WIDTH_INCHES,
    height: PPTX_SLIDE_HEIGHT_INCHES,
  });
  pptx.layout = PPTX_LAYOUT_NAME;

  for (let i = 0; i < presentation.slides.length; i++) {
    const slideData = presentation.slides[i];
    const slide = pptx.addSlide();
    if (slideData.visualSource?.kind === "svg") {
      slide.background = { fill: "FFFFFF" };
      slide.addImage({
        data: `data:image/svg+xml;base64,${utf8ToBase64(slideData.visualSource.markup)}`,
        x: 0,
        y: 0,
        w: PPTX_SLIDE_WIDTH_INCHES,
        h: PPTX_SLIDE_HEIGHT_INCHES,
      });
      if (slideData.speakerNotes) {
        slide.addNotes(slideData.speakerNotes);
      }
      continue;
    }

    throw new Error(
      `Slide ${i + 1} is not SVG-native; element-IR export has been removed.`,
    );
  }

  try {
    await pptx.writeFile({ fileName: filePath });
  } catch (error) {
    logger.error("pptx.write.failed", { filePath, error });
    throw new Error(
      `Unable to write PPTX export: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
