import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { exportToPptx } from "../src/main/ppt-exporter";
import { CommandBus } from "../src/shared/commands";
import { applyLayout } from "../src/shared/layout";
import type { Presentation } from "../src/shared/presentation";
import { createStarterPresentation } from "../src/shared/presentation";
import type { ExportPresentationOptions } from "../src/shared/ipc";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const defaultExportOptions: ExportPresentationOptions = {
  theme: "nordic",
  palette: "cyan",
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function createTempPptxPath(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return join(dir, "export.pptx");
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

function createRichPresentation(): Presentation {
  const slideOneId = crypto.randomUUID();
  const slideTwoId = crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    title: "PPT Export Smoke Test",
    revision: 3,
    theme: "midnight",
    palette: "green",
    slides: [
      {
        id: slideOneId,
        title: "Opening Slide",
        layout: "cover",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 220,
            width: 1040,
            height: 120,
            text: "Agent PPT Export Test",
            fontSize: 48,
            bold: true,
            color: "#f8fafc",
            align: "center",
          },
          {
            id: crypto.randomUUID(),
            type: "shape",
            x: 120,
            y: 380,
            width: 1040,
            height: 8,
            shapeType: "rectangle",
            fillColor: "#10b981",
            strokeColor: "#10b981",
          },
        ],
      },
      {
        id: slideTwoId,
        title: "Content Slide",
        layout: "concept",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 180,
            width: 640,
            height: 320,
            text: "- Bullet one\n- Bullet two\n- Bullet three",
            fontSize: 28,
            color: "#cbd5e1",
          },
          {
            id: crypto.randomUUID(),
            type: "image",
            x: 820,
            y: 180,
            width: 340,
            height: 240,
            url: TINY_PNG_DATA_URL,
            borderRadius: 0,
          },
          {
            id: crypto.randomUUID(),
            type: "shape",
            x: 860,
            y: 460,
            width: 120,
            height: 120,
            shapeType: "circle",
            fillColor: "#38bdf8",
            strokeColor: "#0ea5e9",
          },
        ],
      },
    ],
  };
}

describe("ppt-exporter", () => {
  it("exports the starter presentation to a valid pptx file", async () => {
    const filePath = await createTempPptxPath("ppt-export-starter-");
    const presentation = createStarterPresentation();

    await exportToPptx(presentation, defaultExportOptions, filePath);

    await assertValidPptxFile(filePath, 1);
  });

  it("exports text, image, and shape elements across multiple slides", async () => {
    const filePath = await createTempPptxPath("ppt-export-rich-");
    const presentation = createRichPresentation();

    await exportToPptx(presentation, defaultExportOptions, filePath);

    await assertValidPptxFile(filePath, 2);
  });

  it("exports a localized file URL with spaces and native contain sizing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ppt export localized image-"));
    tempDirs.push(dir);
    const assetDir = join(dir, "asset folder");
    await mkdir(assetDir, { recursive: true });
    const imagePath = join(assetDir, "evidence image.png");
    await writeFile(imagePath, Buffer.from(TINY_PNG_DATA_URL.split(",")[1]!, "base64"));
    const filePath = join(dir, "export.pptx");
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Localized image export",
      revision: 1,
      theme: "nordic",
      palette: "cyan",
      slides: [{
        id: crypto.randomUUID(),
        title: "Evidence",
        layout: "case",
        elements: [{
          id: crypto.randomUUID(),
          type: "image",
          x: 760,
          y: 180,
          width: 360,
          height: 320,
          url: pathToFileURL(imagePath).toString(),
          borderRadius: 0,
          objectFit: "contain",
          asset: { description: "Localized evidence image" },
        }],
      }],
    };

    await exportToPptx(presentation, defaultExportOptions, filePath);
    await assertValidPptxFile(filePath, 1);
  });

  it("exports a presentation built through CommandBus and layout commands", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const firstSlideId = bus.getSnapshot().slides[0].id;

    bus.execute({
      id: crypto.randomUUID(),
      type: "set-presentation-title",
      title: "CommandBus Generated Deck",
    });
    bus.execute({
      id: crypto.randomUUID(),
      type: "set-theme",
      theme: "ocean",
      palette: "purple",
    });
    bus.execute({
      id: crypto.randomUUID(),
      type: "add-slide",
      index: 1,
      slide: {
        id: crypto.randomUUID(),
        title: "Generated Slide",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 220,
            width: 1040,
            height: 200,
            text: "Created by PresentationCommand pipeline",
            fontSize: 32,
          },
        ],
      },
    });
    bus.execute({
      id: crypto.randomUUID(),
      type: "add-element",
      slideId: firstSlideId,
      element: {
        id: crypto.randomUUID(),
        type: "text",
        x: 120,
        y: 220,
        width: 1040,
        height: 200,
        text: "Key takeaway from the deck",
        fontSize: 24,
      },
    });
    bus.execute({
      id: crypto.randomUUID(),
      type: "update-slide-layout",
      slideId: firstSlideId,
      layout: "summary",
    });

    const presentation = bus.getSnapshot();
    expect(presentation.slides).toHaveLength(2);
    expect(presentation.slides[0].elements.length).toBeGreaterThan(0);

    const filePath = await createTempPptxPath("ppt-export-command-bus-");
    await exportToPptx(
      presentation,
      {
        theme: presentation.theme ?? "ocean",
        palette: presentation.palette ?? "purple",
      },
      filePath,
    );

    await assertValidPptxFile(filePath, 2);
  });

  it("keeps layout-generated slide content exportable", async () => {
    const slideId = crypto.randomUUID();
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Layout Export Test",
      revision: 0,
      theme: "sunset",
      palette: "orange",
      slides: [
        applyLayout(
          {
            id: slideId,
            title: "Architecture",
            elements: [
              {
                id: crypto.randomUUID(),
                type: "text",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                text: "Legacy body",
                fontSize: 24,
              },
            ],
          },
          "architecture",
          "sunset",
          "orange",
        ),
      ],
    };

    expect(presentation.slides[0].elements.length).toBeGreaterThan(1);

    const filePath = await createTempPptxPath("ppt-export-layout-");
    await exportToPptx(
      presentation,
      { theme: "sunset", palette: "orange" },
      filePath,
    );

    await assertValidPptxFile(filePath, 1);
  });

  it("exports resolved grid, framed image and report chart treatments", async () => {
    const filePath = await createTempPptxPath("ppt-export-design-system-");
    const presentation: Presentation = {
      id: crypto.randomUUID(),
      title: "Resolved design system",
      revision: 1,
      designTokens: {
        version: 1,
        palette: "soft-academic",
        fontMood: "editorial",
        shapeLanguage: "cards",
        backgroundStyle: "grid",
        motif: "none",
        density: "standard",
        imageTreatment: "framed",
        chartStyle: "report",
      },
      slides: [{
        id: crypto.randomUUID(),
        title: "Visual contract",
        layout: "concept",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "image",
            x: 120,
            y: 180,
            width: 400,
            height: 260,
            url: TINY_PNG_DATA_URL,
            borderRadius: 0,
          },
          {
            id: crypto.randomUUID(),
            type: "chart",
            x: 620,
            y: 180,
            width: 500,
            height: 260,
            chartType: "kpi-tower",
            data: { labels: ["A", "B"], values: [42, 75] },
          },
        ],
      }],
    };

    await exportToPptx(presentation, defaultExportOptions, filePath);
    await assertValidPptxFile(filePath, 1);
  });
});
