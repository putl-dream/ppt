import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("desktop package resources", () => {
  it("ships the runtime skill registry with the packaged app", async () => {
    const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
    const manifest = JSON.parse(await readFile(packagePath, "utf8")) as {
      build?: {
        extraResources?: Array<{ from?: string; to?: string }>;
      };
    };

    expect(manifest.build?.extraResources).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: "skills", to: "skills" })]),
    );
  });
});
