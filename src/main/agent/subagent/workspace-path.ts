import { isAbsolute, relative, resolve } from "node:path";

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const root = resolve(workspaceRoot);
  const filePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, filePath);

  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`Path is outside the workspace sandbox: ${relativePath}`);
  }

  return filePath;
}
