import { z } from "zod";
import { normalizeWorkspacePath } from "./workspace";

export const WORKSPACE_PROJECT_FILE = ".agent-ppt-project.json";
export const WORKSPACE_SANDBOXES_DIR = "sandboxes";

export const workspaceProjectMetaSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  title: z.string(),
});

export type WorkspaceProjectMeta = z.infer<typeof workspaceProjectMetaSchema>;

export function getWorkspaceProjectPath(rootPath: string): string {
  return `${normalizeWorkspacePath(rootPath)}/${WORKSPACE_PROJECT_FILE}`;
}

export function isLegacyProjectSandboxPath(rootPath: string, projectsRootPath: string): boolean {
  const normalizedRoot = normalizeWorkspacePath(rootPath);
  const normalizedProjects = normalizeWorkspacePath(projectsRootPath);
  const prefix = `${normalizedProjects}/session-`;
  return normalizedRoot.startsWith(prefix) && normalizedRoot.length > prefix.length;
}

export function getSessionSandboxPath(workspaceRoot: string, sessionId: string): string {
  return `${normalizeWorkspacePath(workspaceRoot)}/${WORKSPACE_SANDBOXES_DIR}/${sessionId}`;
}

export function isSessionSandboxPath(sandboxPath: string, workspaceRoot: string): boolean {
  const normalizedSandbox = normalizeWorkspacePath(sandboxPath);
  const prefix = `${normalizeWorkspacePath(workspaceRoot)}/${WORKSPACE_SANDBOXES_DIR}/`;
  return normalizedSandbox.startsWith(prefix) && normalizedSandbox.length > prefix.length;
}

export function resolveWorkspaceRootFromProjectPath(
  projectRootPath: string,
  projectsRootPath?: string,
): string {
  const normalized = normalizeWorkspacePath(projectRootPath);
  if (projectsRootPath && isLegacyProjectSandboxPath(normalized, projectsRootPath)) {
    return normalized;
  }
  const sandboxMarker = `/${WORKSPACE_SANDBOXES_DIR}/`;
  const markerIndex = normalized.lastIndexOf(sandboxMarker);
  return markerIndex === -1 ? normalized : normalized.slice(0, markerIndex);
}
