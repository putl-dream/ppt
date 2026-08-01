import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_UI_THEME_ID,
  ensureUiThemesDirectory,
  listUiThemes,
  readUiThemeCss,
  UI_THEME_MAX_BYTES,
} from "@main/ui-themes";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createAppRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-ppt-ui-themes-"));
  temporaryDirectories.push(root);
  return root;
}

describe("ui themes directory", () => {
  it("creates themes directory with README and example.css", async () => {
    const root = await createAppRoot();
    const themesDirectory = ensureUiThemesDirectory(root);

    expect(themesDirectory).toBe(join(root, "themes"));
    const themes = listUiThemes(root);
    expect(themes.some((theme) => theme.id === "example")).toBe(true);
    expect(readUiThemeCss("example", root)).toContain("--surface-canvas");
  });

  it("lists only top-level *.css themes and skips reserved studio id", async () => {
    const root = await createAppRoot();
    const themesDirectory = ensureUiThemesDirectory(root);
    writeFileSync(join(themesDirectory, "midnight.css"), ":root { --surface-canvas: #000; }", "utf8");
    writeFileSync(join(themesDirectory, "studio.css"), ":root { --surface-canvas: #111; }", "utf8");
    writeFileSync(join(themesDirectory, "notes.txt"), "ignore", "utf8");
    mkdirSync(join(themesDirectory, "nested"), { recursive: true });
    writeFileSync(join(themesDirectory, "nested", "hidden.css"), ":root{}", "utf8");

    const themes = listUiThemes(root);
    const ids = themes.map((theme) => theme.id);
    expect(ids).toContain("midnight");
    expect(ids).toContain("example");
    expect(ids).not.toContain(BUILTIN_UI_THEME_ID);
    expect(ids).not.toContain("hidden");
  });

  it("rejects path traversal and invalid ids when reading", async () => {
    const root = await createAppRoot();
    ensureUiThemesDirectory(root);

    expect(readUiThemeCss("../secrets", root)).toBeNull();
    expect(readUiThemeCss("..\\secrets", root)).toBeNull();
    expect(readUiThemeCss("studio", root)).toBeNull();
    expect(readUiThemeCss("", root)).toBeNull();
  });

  it("rejects oversized theme files", async () => {
    const root = await createAppRoot();
    const themesDirectory = ensureUiThemesDirectory(root);
    writeFileSync(
      join(themesDirectory, "huge.css"),
      "x".repeat(UI_THEME_MAX_BYTES + 1),
      "utf8",
    );

    expect(listUiThemes(root).some((theme) => theme.id === "huge")).toBe(true);
    expect(readUiThemeCss("huge", root)).toBeNull();
  });
});
