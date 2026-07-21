import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectPptxExport } from "../src/main/deck/pptx-postflight";
import { exportToPptx } from "../src/main/ppt-exporter";
import { createStarterPresentation } from "../src/shared/presentation";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) =>
    rm(dir, { recursive: true, force: true })
  ));
});

describe("PPTX postflight", () => {
  it("verifies slide parts, titles and editable native objects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pptx-postflight-"));
    tempDirs.push(dir);
    const path = join(dir, "commercial.pptx");
    const presentation = createStarterPresentation();

    await exportToPptx(presentation, {}, path);
    const report = await inspectPptxExport(path, presentation);

    expect(report.passed).toBe(true);
    expect(report.slideCount).toBe(1);
    expect(report.slides[0]).toMatchObject({
      titlePresent: true,
    });
    expect(report.totals.editableObjects).toBeGreaterThan(0);
  });

  it("rejects a non-ZIP file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pptx-postflight-invalid-"));
    tempDirs.push(dir);
    const path = join(dir, "invalid.pptx");
    await writeFile(path, "not a pptx", "utf8");

    await expect(inspectPptxExport(
      path,
      createStarterPresentation(),
    )).rejects.toThrow("not a ZIP-based Office document");
  });
});
