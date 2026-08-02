import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".ts",
  ".tsx",
]);

const FORBIDDEN_DEBUG_MARKERS = [
  ["debug collector endpoint", "http://127.0.0.1:7758"],
  ["debug session header", "X-Debug-Session-Id"],
  ["debug instrumentation region", "#region agent log"],
  ["debug collector path id", "f715bfbd-c4b3-4d7c-91d3-b40633f1a70c"],
  ["debug session id", "4edd08"],
  ["debug session id", "6f9302"],
  ["debug session id", "be1371"],
  ["debug session id", "2488ed"],
  ["debug session id", "f91e95"],
] as const;

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))
      ? [path]
      : [];
  }));
  return files.flat();
}

describe("debug source hygiene", () => {
  it("does not contain known hardcoded debug-reporting artifacts", async () => {
    const sourceRoot = resolve("src");
    const violations: string[] = [];

    for (const filePath of await listSourceFiles(sourceRoot)) {
      const source = await readFile(filePath, "utf8");
      for (const [label, marker] of FORBIDDEN_DEBUG_MARKERS) {
        if (source.includes(marker)) {
          violations.push(`${relative(sourceRoot, filePath)}: ${label}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not grant loopback HTTP access through the renderer CSP", async () => {
    const html = await readFile(resolve("src/renderer/index.html"), "utf8");
    const csp = html.match(/Content-Security-Policy[\s\S]*?content="([^"]+)"/i)?.[1];

    expect(csp).toBeDefined();
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toMatch(/connect-src[^;]*(?:localhost|127\.0\.0\.1)/i);
  });
});
