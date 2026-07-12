import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    try {
      const backup = await readFile(`${filePath}.bak`, "utf8");
      const parsed = JSON.parse(backup) as T;
      await writeTextFileAtomic(filePath, backup);
      return parsed;
    } catch {
      throw error;
    }
  }
}

/**
 * Crash-safe single-file replacement. The temporary file is flushed before it
 * is renamed, and the containing directory is flushed where the platform
 * supports directory handles.
 */
export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  try {
    const current = await readFile(filePath, "utf8");
    JSON.parse(current);
    await writeTextFileAtomic(`${filePath}.bak`, current);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextFileAtomic(filePath: string, payload: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameReplacingExisting(temporaryPath, filePath);

    let directory;
    try {
      directory = await open(dirname(filePath), "r");
      await directory.sync();
    } catch {
      // Windows does not consistently allow opening directories as handles.
    } finally {
      await directory?.close().catch(() => undefined);
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function renameReplacingExisting(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await rename(sourcePath, targetPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
  }

  // Windows rename does not replace an existing destination. Move the valid
  // old file aside first so a failed replacement can still be rolled back.
  const displacedPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.old`;
  let displaced = false;
  try {
    await rename(targetPath, displacedPath);
    displaced = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await rename(sourcePath, targetPath);
  } catch (error) {
    if (displaced) {
      await rename(displacedPath, targetPath).catch(() => undefined);
    }
    throw error;
  }

  if (displaced) await unlink(displacedPath).catch(() => undefined);
}
