import { describe, expect, it } from "vitest";
import {
  createOpenExportFolderHref,
  getOpenExportFolderPath,
} from "../src/shared/export-links";

describe("export links", () => {
  it("round-trips exported file paths through markdown-safe hrefs", () => {
    const filePath = "C:\\Users\\17118\\Documents\\PPTS\\AI\\AI 赋能未来.pptx";
    const href = createOpenExportFolderHref(filePath);

    expect(href).toContain("#open-export-folder=");
    expect(getOpenExportFolderPath(href)).toBe(filePath);
  });

  it("ignores non-export-folder hrefs and malformed encodings", () => {
    expect(getOpenExportFolderPath("https://example.com")).toBeNull();
    expect(getOpenExportFolderPath("#open-export-folder=%E0%A4%A")).toBeNull();
  });
});
