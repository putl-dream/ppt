import { z } from "zod";
import { presentationSchema } from "./presentation";
import {
  projectSandboxSchema,
  sessionChatMessageSchema,
  sessionSummarySchema,
  sessionTranscriptSchema,
} from "./session";
import { normalizeWorkspacePath } from "./workspace";

export const WORKSPACE_META_DIR = ".agent-ppt";
export const WORKSPACE_PROJECT_FILE = "project.json";
export const WORKSPACE_SESSIONS_INDEX_FILE = "sessions.index.json";
export const WORKSPACE_SESSIONS_DIR = "sessions";
/** 工作区下各会话独立沙箱的根目录名 */
export const WORKSPACE_SANDBOXES_DIR = "sandboxes";

export const workspaceProjectMetaSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workspaceSessionIndexEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().optional(),
  slideCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  transcriptPath: z.string(),
  leafMessageUuid: z.string().optional(),
});

export const workspaceSessionsIndexSchema = z.object({
  version: z.literal(1),
  activeSessionId: z.string(),
  sessions: z.array(workspaceSessionIndexEntrySchema),
});

export const workspaceSessionSnapshotSchema = z.object({
  version: z.literal(1),
  session: sessionSummarySchema.omit({ workspacePath: true }),
  presentation: presentationSchema,
  messages: z.array(sessionChatMessageSchema),
  project: projectSandboxSchema,
  transcript: sessionTranscriptSchema.optional(),
});

export type WorkspaceProjectMeta = z.infer<typeof workspaceProjectMetaSchema>;
export type WorkspaceSessionIndexEntry = z.infer<typeof workspaceSessionIndexEntrySchema>;
export type WorkspaceSessionsIndex = z.infer<typeof workspaceSessionsIndexSchema>;
export type WorkspaceSessionSnapshot = z.infer<typeof workspaceSessionSnapshotSchema>;

export function getWorkspaceMetaDir(rootPath: string): string {
  return `${normalizeWorkspacePath(rootPath)}/${WORKSPACE_META_DIR}`;
}

export function getWorkspaceProjectPath(rootPath: string): string {
  return `${getWorkspaceMetaDir(rootPath)}/${WORKSPACE_PROJECT_FILE}`;
}

export function getWorkspaceSessionsIndexPath(rootPath: string): string {
  return `${getWorkspaceMetaDir(rootPath)}/${WORKSPACE_SESSIONS_INDEX_FILE}`;
}

export function getWorkspaceSessionSnapshotPath(rootPath: string, sessionId: string): string {
  return `${getWorkspaceMetaDir(rootPath)}/${WORKSPACE_SESSIONS_DIR}/${sessionId}.json`;
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
  if (markerIndex !== -1) {
    return normalized.slice(0, markerIndex);
  }

  return normalized;
}

export function isFlatWorkspaceSandboxPath(projectRootPath: string, projectsRootPath?: string): boolean {
  const normalized = normalizeWorkspacePath(projectRootPath);
  if (projectsRootPath && isLegacyProjectSandboxPath(normalized, projectsRootPath)) {
    return false;
  }
  return !normalized.includes(`/${WORKSPACE_SANDBOXES_DIR}/`);
}
