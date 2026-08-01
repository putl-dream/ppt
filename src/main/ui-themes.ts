import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import type { UiThemeSummary } from "@shared/ipc";
import { getApplicationDataRoot } from "./application-data";

export type { UiThemeSummary };

export const BUILTIN_UI_THEME_ID = "studio";
export const UI_THEMES_DIRECTORY_NAME = "themes";
export const UI_THEME_MAX_BYTES = 256 * 1024;

const THEME_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

const THEMES_README = `# UI themes

Drop a \`.css\` file here to add a workbench appearance theme (Typora-style).

## Stable contract (recommended)

Override semantic CSS variables for light/dark:

\`\`\`css
:root[data-color-scheme="dark"] {
  --surface-canvas: #0f1419;
  --surface-base: #151b22;
  --surface-raised: #1b222c;
  --surface-sunken: #10151b;
  --surface-overlay: #222a35;
  --text-primary: #f3f6fa;
  --text-secondary: #a8b3c2;
  --text-muted: #7b8796;
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.1);
}

:root[data-color-scheme="light"] {
  --surface-canvas: #e7ebf0;
  --surface-base: #eef1f5;
  --surface-raised: #ffffff;
  --surface-sunken: #f3f5f8;
  --surface-overlay: #ffffff;
  --text-primary: #12161c;
  --text-secondary: #4a5563;
  --text-muted: #6b7280;
  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-default: rgba(0, 0, 0, 0.1);
}
\`\`\`

## Deep customization

Prefer region hooks when targeting chrome:

- \`[data-ui-region="sidebar"]\`
- \`[data-ui-region="composer"]\`
- \`[data-ui-region="canvas"]\`
- \`[data-ui-region="settings"]\`

Component class names may change between versions. Slide paper / deck preview surfaces are intentionally not theme-driven.

Select the theme in Settings → 界面外观. Refresh the list after adding files.
`;

const EXAMPLE_THEME_CSS = `/*
 * example — token-only workbench theme for verifying UI theme loading.
 * Select it in Settings → 界面外观 after placing this file in the themes folder.
 */

:root[data-color-scheme="dark"] {
  --surface-canvas: #0f1419;
  --surface-base: #151b22;
  --surface-raised: #1b222c;
  --surface-sunken: #10151b;
  --surface-overlay: #222a35;
  --surface-hover: rgba(255, 255, 255, 0.06);
  --surface-active: rgba(255, 255, 255, 0.1);

  --text-primary: #f3f6fa;
  --text-secondary: #a8b3c2;
  --text-muted: #7b8796;

  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.1);
  --border-strong: rgba(255, 255, 255, 0.16);
  --border-focused: rgba(255, 255, 255, 0.22);
}

:root[data-color-scheme="light"] {
  --surface-canvas: #dde3ea;
  --surface-base: #e7ecf2;
  --surface-raised: #f7f9fc;
  --surface-sunken: #eef2f7;
  --surface-overlay: #ffffff;
  --surface-hover: rgba(0, 0, 0, 0.04);
  --surface-active: rgba(0, 0, 0, 0.07);

  --text-primary: #12161c;
  --text-secondary: #4a5563;
  --text-muted: #6b7280;

  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-default: rgba(0, 0, 0, 0.1);
  --border-strong: rgba(0, 0, 0, 0.14);
  --border-focused: rgba(0, 0, 0, 0.2);
}
`;

export function getUiThemesDirectory(applicationDataRoot?: string): string {
  return join(applicationDataRoot ?? getApplicationDataRoot(), UI_THEMES_DIRECTORY_NAME);
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  const resolvedCandidate = resolve(candidatePath);
  const resolvedDirectory = resolve(directoryPath);
  return (
    resolvedCandidate === resolvedDirectory
    || resolvedCandidate.startsWith(resolvedDirectory + sep)
  );
}

export function isValidUiThemeId(id: string): boolean {
  return THEME_ID_PATTERN.test(id) && id !== BUILTIN_UI_THEME_ID;
}

function themeDisplayName(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveThemeCssPath(themesDirectory: string, id: string): string | null {
  if (!isValidUiThemeId(id)) return null;
  const filePath = resolve(themesDirectory, `${id}.css`);
  if (!isPathInsideDirectory(filePath, themesDirectory)) return null;
  if (basename(filePath) !== `${id}.css`) return null;
  return filePath;
}

export function ensureUiThemesDirectory(applicationDataRoot?: string): string {
  const themesDirectory = getUiThemesDirectory(applicationDataRoot);
  mkdirSync(themesDirectory, { recursive: true });

  const readmePath = join(themesDirectory, "README.md");
  try {
    statSync(readmePath);
  } catch {
    writeFileSync(readmePath, THEMES_README, "utf8");
  }

  const examplePath = join(themesDirectory, "example.css");
  try {
    statSync(examplePath);
  } catch {
    writeFileSync(examplePath, EXAMPLE_THEME_CSS, "utf8");
  }

  return themesDirectory;
}

export function listUiThemes(applicationDataRoot?: string): UiThemeSummary[] {
  const themesDirectory = ensureUiThemesDirectory(applicationDataRoot);
  let entries: string[];
  try {
    entries = readdirSync(themesDirectory);
  } catch {
    return [];
  }

  return entries
    .filter((fileName) => {
      if (fileName.startsWith("README")) return false;
      if (extname(fileName).toLowerCase() !== ".css") return false;
      const id = basename(fileName, extname(fileName));
      return isValidUiThemeId(id);
    })
    .map((fileName) => {
      const id = basename(fileName, extname(fileName));
      return {
        id,
        name: themeDisplayName(id),
        fileName,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function readUiThemeCss(
  id: string,
  applicationDataRoot?: string,
): string | null {
  const themesDirectory = ensureUiThemesDirectory(applicationDataRoot);
  const filePath = resolveThemeCssPath(themesDirectory, id);
  if (!filePath) return null;

  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.size > UI_THEME_MAX_BYTES) return null;

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
