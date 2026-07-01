import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportPptxTool } from "../src/main/agent/tools/deferred/export-pptx";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import { createStarterPresentation } from "../src/shared/presentation";

let tempExportDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempExportDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempExportDirs = [];
});

describe("ExportPptx deferred tool", () => {
  it("exports a real pptx file instead of returning a mock path", async () => {
    const presentation = createStarterPresentation();
    const registry = createDefaultToolRegistry();
    const context = {
      presentation,
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry,
      messageHistory: [],
    };

    const result = await exportPptxTool.execute({ format: "pptx" }, context);

    expect(result.success).toBe(true);
    expect(result.filePath).not.toMatch(/^\/mock\//);
    expect(result.filePath.endsWith(".pptx")).toBe(true);
    expect(result.slideCount).toBe(presentation.slides.length);

    tempExportDirs.push(join(result.filePath, ".."));
  });

  it("rejects pdf export", async () => {
    const registry = createDefaultToolRegistry();
    const context = {
      presentation: createStarterPresentation(),
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry,
      messageHistory: [],
    };

    await expect(exportPptxTool.execute({ format: "pdf" }, context)).rejects.toThrow(
      "PDF export is not supported yet",
    );
  });
});
