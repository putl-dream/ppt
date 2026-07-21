import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exportToPptx } from "../src/main/ppt-exporter";
import { inspectPptxExport } from "../src/main/deck/pptx-postflight";
import {
  LeanV2Pipeline,
  type CommercialAssetResolver,
} from "../src/main/agent/lean/lean-v2-pipeline";
import { leanDeckSpecV2Schema } from "../src/shared/lean/deck-spec-v2";
import { createStarterPresentation } from "../src/shared/presentation";
import { exportDeckContactSheetHtml } from "../src/shared/html-exporter";

const fixtureName = "commercial-visual-growth-os.json";

const noExternalAssets: CommercialAssetResolver = {
  async resolve(requests) {
    return {
      version: 1,
      assets: requests.map((request) => ({
        requestId: request.requestId,
        slotId: request.slotId,
        status: "unavailable" as const,
        licenseStatus: "unknown" as const,
        rejectionCodes: ["commercial-fixture-uses-native-visuals"],
      })),
    };
  },
};

function createDeterministicStarterPresentation() {
  const presentation = createStarterPresentation();
  presentation.id = "commercial-fixture-presentation";
  presentation.slides[0]!.id = "commercial-fixture-opening";
  presentation.slides[0]!.elements[0]!.id = "commercial-fixture-title";
  return presentation;
}

async function main(): Promise<void> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fixturePath = resolve(
    projectRoot,
    "tests",
    "fixtures",
    fixtureName,
  );
  const outputDir = resolve(projectRoot, "output", "commercial");
  const pptxPath = resolve(outputDir, "growth-operating-system.pptx");
  const reportPath = resolve(outputDir, "growth-operating-system.quality.json");
  const presentationPath = resolve(
    outputDir,
    "growth-operating-system.presentation.json",
  );
  const contactSheetPath = resolve(
    outputDir,
    "growth-operating-system.contact-sheet.html",
  );

  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const spec = leanDeckSpecV2Schema.parse(fixture);
  const pipeline = new LeanV2Pipeline(noExternalAssets);
  const result = await pipeline.create({
    spec,
    basePresentation: createDeterministicStarterPresentation(),
  });

  await mkdir(outputDir, { recursive: true });
  await exportToPptx(result.presentation, {}, pptxPath);
  const postflight = await inspectPptxExport(pptxPath, result.presentation);
  if (!postflight.passed) {
    throw new Error(`PPTX postflight failed: ${postflight.errors.join("; ")}`);
  }
  await writeFile(
    reportPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      fixture: fixtureName,
      title: result.presentation.title,
      slideCount: result.presentation.slides.length,
      canonicalHash: result.canonicalHash,
      scenes: result.plan.slides.map((slide) => ({
        slideIndex: slide.slideIndex,
        sceneId: slide.sceneId,
        variantId: slide.variantId,
        backgroundMode: slide.backgroundMode,
      })),
      quality: result.quality,
      postflight,
      timings: result.timings,
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    presentationPath,
    `${JSON.stringify(result.presentation, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    contactSheetPath,
    exportDeckContactSheetHtml(result.presentation),
    "utf8",
  );

  console.log(`PPTX: ${pptxPath}`);
  console.log(`Quality report: ${reportPath}`);
  console.log(`Presentation JSON: ${presentationPath}`);
  console.log(`Contact sheet: ${contactSheetPath}`);
  console.log(`Slides: ${result.presentation.slides.length}`);
  console.log(`Scenes: ${result.quality.sceneStats.distinctScenes}`);
  console.log(`Machine quality score: ${result.quality.scores.overall}`);
  console.log(`Human visual review: ${result.quality.humanReview.status}`);
  console.log(`Editable PPTX objects: ${postflight.totals.editableObjects}`);
  console.log(`Native chart parts: ${postflight.chartPartCount}`);
  console.log(`Speaker notes parts: ${postflight.notesPartCount}`);
  console.log(`Canonical hash: ${result.canonicalHash}`);
}

main().catch((error) => {
  console.error("Commercial PPT generation failed:", error);
  process.exitCode = 1;
});
