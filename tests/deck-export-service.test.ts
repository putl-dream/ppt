import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeckExportService } from "../src/main/deck/deck-export-service";
import { createStarterPresentation } from "../src/shared/presentation";
import type { ExportPresentationOptions } from "../src/shared/ipc";

const defaultExportOptions: ExportPresentationOptions = {
  theme: "nordic",
  palette: "cyan",
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function createTempExportPath(prefix: string, ext: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return join(dir, `export.${ext}`);
}

async function assertValidPptxFile(filePath: string, expectedSlideCount: number): Promise<void> {
  const info = await stat(filePath);
  expect(info.isFile()).toBe(true);
  expect(info.size).toBeGreaterThan(1024);

  const buffer = await readFile(filePath);
  expect(buffer.subarray(0, 4).toString("hex")).toBe("504b0304");

  const archiveText = buffer.toString("latin1");
  expect(archiveText).toContain("[Content_Types].xml");
  expect(archiveText).toContain("ppt/presentation.xml");
  expect(archiveText).toContain("ppt/slides/slide1.xml");

  const slideParts = archiveText.match(/ppt\/slides\/slide\d+\.xml/g) ?? [];
  expect(new Set(slideParts).size).toBe(expectedSlideCount);
}

describe("DeckExportService", () => {
  const service = new DeckExportService();

  it("exports presentation to a valid pptx file", async () => {
    const presentation = createStarterPresentation();
    const filePath = await createTempExportPath("deck-export-pptx-", "pptx");

    const result = await service.exportDeck({
      presentation,
      options: defaultExportOptions,
      filePath,
    });

    expect(result.filePath).toBe(filePath);
    expect(result.slideCount).toBe(presentation.slides.length);
    await assertValidPptxFile(filePath, presentation.slides.length);
  });

  it("exports presentation to json when file path ends with .json", async () => {
    const presentation = createStarterPresentation();
    const filePath = await createTempExportPath("deck-export-json-", "json");

    const result = await service.exportDeck({
      presentation,
      options: defaultExportOptions,
      filePath,
    });

    expect(result.filePath).toBe(filePath);
    expect(result.slideCount).toBe(presentation.slides.length);

    const saved = JSON.parse(await readFile(filePath, "utf8"));
    expect(saved.title).toBe(presentation.title);
    expect(saved.slides).toHaveLength(presentation.slides.length);
  });

  it("generates a default export path when filePath is omitted", async () => {
    const presentation = createStarterPresentation();

    const result = await service.exportDeck({
      presentation,
      options: defaultExportOptions,
    });

    expect(result.filePath.endsWith(".pptx")).toBe(true);
    expect(result.slideCount).toBe(presentation.slides.length);
    await assertValidPptxFile(result.filePath, presentation.slides.length);

    tempDirs.push(join(result.filePath, ".."));
  });
});
