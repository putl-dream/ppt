import type { ProjectArtifact } from "@shared/session";

export function findArtifactByProjectPath(
  artifacts: ProjectArtifact[],
  relativePath: string,
): ProjectArtifact | undefined {
  const normalizedPath = normalizeProjectPath(relativePath);
  return artifacts.find((artifact) => {
    const artifactPath = normalizeProjectPath(artifact.path);
    if (artifact.path.endsWith("/")) {
      return normalizedPath === artifactPath || normalizedPath.startsWith(`${artifactPath}/`);
    }
    return normalizedPath === artifactPath;
  });
}

export function getDownstreamArtifactIds(
  artifacts: ProjectArtifact[],
  artifactId: string,
): string[] {
  const downstreamById = new Map<string, string[]>();
  for (const artifact of artifacts) {
    for (const dependencyId of artifact.dependsOn) {
      const downstream = downstreamById.get(dependencyId) ?? [];
      downstream.push(artifact.id);
      downstreamById.set(dependencyId, downstream);
    }
  }

  const visited = new Set<string>();
  const queue = [...(downstreamById.get(artifactId) ?? [])];
  while (queue.length > 0) {
    const nextId = queue.shift();
    if (!nextId || visited.has(nextId)) continue;
    visited.add(nextId);
    queue.push(...(downstreamById.get(nextId) ?? []));
  }

  return artifacts
    .map((artifact) => artifact.id)
    .filter((id) => visited.has(id));
}

export function markDownstreamArtifactsStale(
  artifacts: ProjectArtifact[],
  artifactId: string,
): string[] {
  const downstreamIds = getDownstreamArtifactIds(artifacts, artifactId);
  const downstreamIdSet = new Set(downstreamIds);
  for (const artifact of artifacts) {
    if (artifact.id === artifactId) {
      artifact.status = artifact.status === "ready" ? "draft" : artifact.status;
    } else if (downstreamIdSet.has(artifact.id)) {
      artifact.status = "stale";
    }
  }
  return downstreamIds;
}

function normalizeProjectPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}
