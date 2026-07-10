import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { resolveAgentPath } from "./workspace-path";

export async function ensureWorkspaceDir(workspaceRoot: string, path: string): Promise<void> {
  const dirPath = resolveAgentPath(workspaceRoot, path);
  await mkdir(dirPath, { recursive: true });
}

export async function readWorkspaceText(workspaceRoot: string, path: string): Promise<string> {
  const filePath = resolveAgentPath(workspaceRoot, path);
  return await readFile(filePath, "utf8");
}

export async function writeWorkspaceText(
  workspaceRoot: string,
  path: string,
  content: string,
): Promise<void> {
  const filePath = resolveAgentPath(workspaceRoot, path);
  const targetDir = dirname(filePath);
  await mkdir(targetDir, { recursive: true });

  const tempPath = join(
    targetDir,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(tempPath, content, "utf8");
    const written = await readFile(tempPath, "utf8");
    if (written !== content) {
      throw new Error(`Atomic write verification failed for ${path}`);
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function editWorkspaceText(
  workspaceRoot: string,
  path: string,
  oldString: string,
  newString: string,
): Promise<void> {
  const content = await readWorkspaceText(workspaceRoot, path);
  const index = content.indexOf(oldString);
  if (index < 0) {
    throw new Error(`old_string not found in ${path}`);
  }
  const updated = `${content.slice(0, index)}${newString}${content.slice(index + oldString.length)}`;
  await writeWorkspaceText(workspaceRoot, path, updated);
}

export async function globWorkspaceFiles(workspaceRoot: string, pattern: string): Promise<string[]> {
  const matcher = globToRegExp(pattern.replace(/\\/g, "/"));
  const results: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = resolveAgentPath(workspaceRoot, relativeDir || ".");
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      const normalized = relativePath.replace(/\\/g, "/");
      if (matcher.test(normalized)) {
        results.push(normalized);
      }
    }
  }

  await walk("");
  return results.sort((left, right) => left.localeCompare(right));
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  const doubleStarPlaceholder = "__DOUBLE_STAR__";
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, doubleStarPlaceholder)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(doubleStarPlaceholder, "g"), ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}
