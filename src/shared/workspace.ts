import { resolveWorkspaceRootFromProjectPath } from "./workspace-meta";

/**
 * Normalize workspace paths for stable comparison across platforms.
 */
export function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-zA-Z]:/.test(normalized)) {
    return normalized.charAt(0).toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

export function getWorkspaceLabel(path?: string): string {
  if (!path) return "未打开项目目录";
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

export function resolveWorkspacePath(
  session: { workspacePath?: string; projectRootPath?: string },
  projectsRootPath?: string,
): string | undefined {
  if (session.workspacePath) {
    return normalizeWorkspacePath(session.workspacePath);
  }
  if (session.projectRootPath) {
    return normalizeWorkspacePath(
      resolveWorkspaceRootFromProjectPath(session.projectRootPath, projectsRootPath),
    );
  }
  return undefined;
}

export function sessionsForWorkspace<T extends { workspacePath?: string }>(
  sessions: T[],
  workspacePath?: string,
): T[] {
  if (!workspacePath) return sessions;
  const normalized = normalizeWorkspacePath(workspacePath);
  return sessions.filter(
    (session) =>
      session.workspacePath &&
      normalizeWorkspacePath(session.workspacePath) === normalized,
  );
}

export function sessionBelongsToWorkspace(
  session: { workspacePath?: string; projectRootPath?: string },
  workspacePath: string,
  projectsRootPath?: string,
): boolean {
  const resolved = resolveWorkspacePath(session, projectsRootPath);
  return resolved === normalizeWorkspacePath(workspacePath);
}

export function getSessionActivityTime(session: {
  lastMessageAt?: string;
  createdAt: string;
}): string {
  return session.lastMessageAt ?? session.createdAt;
}

export function compareSessionsByActivity<
  T extends { lastMessageAt?: string; createdAt: string },
>(left: T, right: T): number {
  return getSessionActivityTime(right).localeCompare(getSessionActivityTime(left));
}

export function groupSessionsByWorkspace<T extends { workspacePath?: string }>(
  sessions: T[],
): Array<{ workspacePath: string; sessions: T[] }> {
  const groups = new Map<string, T[]>();
  for (const session of sessions) {
    const key = session.workspacePath
      ? normalizeWorkspacePath(session.workspacePath)
      : "__unknown__";
    const bucket = groups.get(key) ?? [];
    bucket.push(session);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "__unknown__") return 1;
      if (right === "__unknown__") return -1;
      return left.localeCompare(right);
    })
    .map(([workspacePath, groupedSessions]) => ({
      workspacePath,
      sessions: groupedSessions.sort((a, b) =>
        "createdAt" in a && "createdAt" in b
          ? compareSessionsByActivity(
              a as T & { lastMessageAt?: string; createdAt: string },
              b as T & { lastMessageAt?: string; createdAt: string },
            )
          : 0,
      ),
    }));
}
