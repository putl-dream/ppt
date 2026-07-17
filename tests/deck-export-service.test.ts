import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeckExportService } from "../src/main/deck/deck-export-service";
import { createStarterPresentation } from "../src/shared/presentation";
import type { ExportPresentationOptions } from "../src/shared/ipc";

const defaultExportOptions: ExportPresentationOptions = {};
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

  it("exports presentation to html when file path ends with .html", async () => {
    const presentation = createStarterPresentation();
    const filePath = await createTempExportPath("deck-export-html-", "html");

    const result = await service.exportDeck({
      presentation,
      options: defaultExportOptions,
      filePath,
    });

    expect(result.filePath).toBe(filePath);
    const html = await readFile(filePath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(presentation.title);
  });

  it("embeds local images and the configured logo into portable HTML", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "deck-export-html-assets-"));
    tempDirs.push(workspaceRoot);
    const imagePath = join(workspaceRoot, "photo.png");
    await writeFile(imagePath, Buffer.from(TINY_PNG_DATA_URL.split(",")[1], "base64"));

    const presentation = createStarterPresentation();
    presentation.slides[0].elements.push({
      id: "local-image",
      type: "image",
      x: 120,
      y: 200,
      width: 400,
      height: 240,
      url: "photo.png",
      borderRadius: 0,
    });
    const filePath = join(workspaceRoot, "export.html");

    await service.exportDeck({
      presentation,
      options: { logoUrl: TINY_PNG_DATA_URL },
      filePath,
      workspaceRoot,
    });

    const html = await readFile(filePath, "utf8");
    expect(html).toContain(`src="${TINY_PNG_DATA_URL}"`);
    expect(html).not.toContain("src=\"photo.png\"");
    expect(html.match(/<img class="export-brand-logo"/g)).toHaveLength(
      presentation.slides.length,
    );
  });

  it("rejects forged local paths in export options", async () => {
    const presentation = createStarterPresentation();
    const filePath = await createTempExportPath("deck-export-options-", "pptx");

    await expect(service.exportDeck({
      presentation,
      options: { logoUrl: "C:\\private\\logo.png" } as ExportPresentationOptions,
      filePath,
    })).rejects.toThrow("Image data must be");
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

  it("blocks renderable exports that still contain remote images", async () => {
    const presentation = createStarterPresentation();
    presentation.slides[0].elements.push({
      id: "remote-image",
      type: "image",
      x: 120,
      y: 200,
      width: 400,
      height: 240,
      url: "https://example.com/image.png",
      borderRadius: 0,
    });
    const filePath = await createTempExportPath("deck-export-remote-", "html");

    await expect(service.exportDeck({
      presentation,
      options: defaultExportOptions,
      filePath,
    })).rejects.toThrow("remote URL");
  });

  it("still allows JSON recovery export for decks with unresolved assets", async () => {
    const presentation = createStarterPresentation();
    presentation.slides[0].elements.push({
      id: "remote-image",
      type: "image",
      x: 120,
      y: 200,
      width: 400,
      height: 240,
      url: "https://example.com/image.png",
      borderRadius: 0,
    });
    const filePath = await createTempExportPath("deck-export-recovery-", "json");

    await expect(service.exportDeck({
      presentation,
      options: defaultExportOptions,
      filePath,
    })).resolves.toMatchObject({ filePath });
  });
});
