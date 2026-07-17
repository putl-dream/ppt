import { create } from "zustand";
import type { ProjectArtifact, ProjectArtifactStatus } from "@shared/session";
import type { ProjectArtifactWriteResult } from "@shared/ipc";
import {
  getPrimaryProjectArtifactPath,
  isProjectStageId,
  primaryProjectArtifactPaths,
  projectStageIds,
  type ProjectStageId,
} from "@shared/project";
import {
  createDefaultBriefMarkdown,
  createDefaultProjectDesignSystem,
  createDefaultOutlineMarkdown,
  createDefaultResearchMarkdown,
  serializeProjectDesignSystem,
} from "@shared/project-artifacts";

export type ArtifactId = ProjectStageId;
export type ArtifactStatus = ProjectArtifactStatus;

export interface Artifact {
  id: ArtifactId;
  name: string;
  path: string;
  status: ArtifactStatus;
  version: string;
  content: string;
  upstreamDependencies: ArtifactId[];
  lastUpdatedBy: "user" | "agent";
  updatedAt: number;
  isHydrated: boolean;
  lastWriteError?: string;
}

export interface ActiveProject {
  id: string;
  name: string;
  artifacts: Record<ArtifactId, Artifact>;
  history: {
    commitId: string;
    timestamp: number;
    description: string;
    snapshot: Record<ArtifactId, string>;
  }[];
}

interface ProjectState {
  activeProject: ActiveProject | null;

  initializeProject: (id: string, name: string, backendArtifacts?: ProjectArtifact[]) => void;
  hydrateProjectArtifacts: (sessionId?: string) => Promise<void>;
  updateArtifactContent: (id: ArtifactId, content: string, by?: "user" | "agent") => void;
  markStageReady: (id: ArtifactId) => Promise<void>;
  resetProject: () => void;
}

const DEFAULT_ARTIFACTS: Record<ArtifactId, Omit<Artifact, "content" | "isHydrated">> = {
  brief: {
    id: "brief",
    name: "目的、方向与受众 (Brief)",
    path: primaryProjectArtifactPaths.brief,
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: [],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  outline: {
    id: "outline",
    name: "内容大纲 (Outline)",
    path: primaryProjectArtifactPaths.outline,
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["brief"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  research: {
    id: "research",
    name: "资料与素材 (Research)",
    path: primaryProjectArtifactPaths.research,
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["outline"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  slides: {
    id: "slides",
    name: "逐页方案 (Slides Plan)",
    path: primaryProjectArtifactPaths.slides,
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["outline", "research", "design"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  design: {
    id: "design",
    name: "设计系统与偏好 (Design)",
    path: primaryProjectArtifactPaths.design,
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["brief"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  deck: {
    id: "deck",
    name: "PPT 预览与导出 (Deck)",
    path: primaryProjectArtifactPaths.deck,
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["slides", "design"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
};

export const DEFAULT_CONTENTS: Record<ArtifactId, string> = {
  brief: createDefaultBriefMarkdown(),
  outline: createDefaultOutlineMarkdown(),
  research: createDefaultResearchMarkdown(),
  slides: JSON.stringify(
    [
      {
        title: "封面页",
        layout: "cover",
        keyPoints: ["智能硬件市场推广", "主讲人: AI 助手"],
        quote: "",
      },
    ],
    null,
    2,
  ),
  design: serializeProjectDesignSystem(createDefaultProjectDesignSystem()).trimEnd(),
  deck: JSON.stringify(
    {
      title: "新演示文稿",
      slides: [],
    },
    null,
    2,
  ),
};

const DEPENDENCY_MAP: Record<ArtifactId, ArtifactId[]> = {
  brief: ["outline", "design", "slides", "deck"],
  outline: ["slides", "deck"],
  research: ["slides", "deck"],
  design: ["slides", "deck"],
  slides: ["deck"],
  deck: [],
};

const writeTimers = new Map<string, any>();

function getDesktopApi() {
  return typeof window === "undefined" ? undefined : (window as any).desktopApi;
}

function createArtifactShell(
  id: ArtifactId,
  backendArtifacts?: ProjectArtifact[],
): Artifact {
  const backend = backendArtifacts?.find((artifact) => artifact.id === id);
  const dependencies = (backend?.dependsOn ?? DEFAULT_ARTIFACTS[id].upstreamDependencies)
    .filter(isProjectStageId);

  return {
    ...DEFAULT_ARTIFACTS[id],
    name: backend?.title ?? DEFAULT_ARTIFACTS[id].name,
    path: backend ? getPrimaryProjectArtifactPath(backend) : DEFAULT_ARTIFACTS[id].path,
    status: backend?.status ?? DEFAULT_ARTIFACTS[id].status,
    upstreamDependencies: dependencies,
    content: DEFAULT_CONTENTS[id],
    updatedAt: Date.now(),
    isHydrated: false,
  };
}

function propagateStale(
  artifacts: Record<ArtifactId, Artifact>,
  startId: ArtifactId,
): Record<ArtifactId, Artifact> {
  const nextArtifacts = { ...artifacts };
  const queue = [...(DEPENDENCY_MAP[startId] || [])];
  const visited = new Set<ArtifactId>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    nextArtifacts[current] = {
      ...nextArtifacts[current],
      status: "stale",
      updatedAt: Date.now(),
    };

    queue.push(...(DEPENDENCY_MAP[current] || []));
  }

  return nextArtifacts;
}

function applyWriteResult(
  artifacts: Record<ArtifactId, Artifact>,
  result: ProjectArtifactWriteResult,
): Record<ArtifactId, Artifact> {
  const nextArtifacts = { ...artifacts };
  const changedId = result.changedArtifactId;
  const now = Date.now();

  if (changedId && isProjectStageId(changedId)) {
    const current = nextArtifacts[changedId];
    nextArtifacts[changedId] = {
      ...current,
      status: current.status === "ready" ? "draft" : current.status,
      updatedAt: now,
      lastWriteError: undefined,
    };
  }

  for (const artifactId of result.staleArtifactIds) {
    if (!isProjectStageId(artifactId)) continue;
    nextArtifacts[artifactId] = {
      ...nextArtifacts[artifactId],
      status: "stale",
      updatedAt: now,
      lastWriteError: undefined,
    };
  }

  return nextArtifacts;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProject: null,

  initializeProject: (id, name, backendArtifacts) => {
    const artifacts = Object.fromEntries(
      projectStageIds.map((stageId) => [stageId, createArtifactShell(stageId, backendArtifacts)]),
    ) as Record<ArtifactId, Artifact>;

    set({
      activeProject: {
        id,
        name,
        artifacts,
        history: [],
      },
    });
  },

  hydrateProjectArtifacts: async (sessionId) => {
    const project = get().activeProject;
    const targetSessionId = sessionId ?? project?.id;
    const api = getDesktopApi();
    if (!project || !targetSessionId || targetSessionId === "draft_id" || !api) return;

    const loadedEntries = await Promise.all(
      projectStageIds.map(async (stageId) => {
        const artifact = get().activeProject?.artifacts[stageId];
        if (!artifact) return [stageId, undefined] as const;
        try {
          const result = await api.readProjectArtifact(targetSessionId, artifact.path);
          return [stageId, result.type === "file" ? result.content ?? "" : ""] as const;
        } catch (error) {
          console.error(`读取项目产物失败: ${artifact.path}`, error);
          return [stageId, undefined] as const;
        }
      }),
    );

    set((state) => {
      if (!state.activeProject || state.activeProject.id !== targetSessionId) return {};
      const artifacts = { ...state.activeProject.artifacts };
      for (const [stageId, content] of loadedEntries) {
        if (content === undefined) continue;
        artifacts[stageId] = {
          ...artifacts[stageId],
          content,
          isHydrated: true,
          lastWriteError: undefined,
          updatedAt: Date.now(),
        };
      }
      return {
        activeProject: {
          ...state.activeProject,
          artifacts,
        },
      };
    });
  },

  updateArtifactContent: (id, content, by = "user") => {
    const project = get().activeProject;
    if (!project) return;

    const artifact = project.artifacts[id];
    set((state) => {
      if (!state.activeProject) return {};

      const updatedArtifact = {
        ...state.activeProject.artifacts[id],
        content,
        lastUpdatedBy: by,
        updatedAt: Date.now(),
        lastWriteError: undefined,
      };

      const artifacts = propagateStale(
        {
          ...state.activeProject.artifacts,
          [id]: updatedArtifact,
        },
        id,
      );

      return {
        activeProject: {
          ...state.activeProject,
          artifacts,
        },
      };
    });

    const api = getDesktopApi();
    if (!api || project.id === "draft_id") return;

    const timerKey = `${project.id}:${id}`;
    const existingTimer = writeTimers.get(timerKey);
    if (existingTimer) window.clearTimeout(existingTimer);

    writeTimers.set(
      timerKey,
      window.setTimeout(() => {
        writeTimers.delete(timerKey);
        void api
          .writeProjectArtifact(project.id, artifact.path, content)
          .then((result: ProjectArtifactWriteResult) => {
            set((state) => {
              if (!state.activeProject || state.activeProject.id !== project.id) return {};
              return {
                activeProject: {
                  ...state.activeProject,
                  artifacts: applyWriteResult(state.activeProject.artifacts, result),
                },
              };
            });
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "写入项目产物失败";
            console.error(`写入项目产物失败: ${artifact.path}`, error);
            set((state) => {
              if (!state.activeProject || state.activeProject.id !== project.id) return {};
              const current = state.activeProject.artifacts[id];
              return {
                activeProject: {
                  ...state.activeProject,
                  artifacts: {
                    ...state.activeProject.artifacts,
                    [id]: {
                      ...current,
                      lastWriteError: message,
                    },
                  },
                },
              };
            });
          });
      }, 400),
    );
  },

  markStageReady: async (id) => {
    const project = get().activeProject;
    if (!project) return;

    const api = getDesktopApi();
    if (!api || project.id === "draft_id") {
      set((state) => {
        if (!state.activeProject || state.activeProject.id !== project.id) return {};
        const currentArtifact = state.activeProject.artifacts[id];
        return {
          activeProject: {
            ...state.activeProject,
            artifacts: {
              ...state.activeProject.artifacts,
              [id]: {
                ...currentArtifact,
                status: "ready",
                updatedAt: Date.now(),
                lastWriteError: undefined,
              },
            },
          },
        };
      });
      return;
    }

    const artifact = project.artifacts[id];
    const timerKey = `${project.id}:${id}`;
    const existingTimer = writeTimers.get(timerKey);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      writeTimers.delete(timerKey);
    }

    try {
      const result: ProjectArtifactWriteResult = await api.writeProjectArtifact(
        project.id,
        artifact.path,
        artifact.content,
      );
      const latestArtifact = get().activeProject?.id === project.id
        ? get().activeProject?.artifacts[id]
        : undefined;
      if (!latestArtifact || latestArtifact.content !== artifact.content) {
        throw new Error(`Artifact '${id}' changed while it was being confirmed; confirm it again.`);
      }
      set((state) => {
        if (!state.activeProject || state.activeProject.id !== project.id) return {};
        return {
          activeProject: {
            ...state.activeProject,
            artifacts: applyWriteResult(state.activeProject.artifacts, result),
          },
        };
      });

      const markedArtifact = await api.markProjectArtifactStatus(project.id, id, "ready");
      if (!markedArtifact || markedArtifact.id !== id || markedArtifact.status !== "ready") {
        throw new Error(`Backend did not confirm artifact '${id}' as ready.`);
      }
      set((state) => {
        if (!state.activeProject || state.activeProject.id !== project.id) return {};
        return {
          activeProject: {
            ...state.activeProject,
            artifacts: {
              ...state.activeProject.artifacts,
              [id]: {
                ...state.activeProject.artifacts[id],
                status: markedArtifact.status,
                updatedAt: Date.now(),
                lastWriteError: undefined,
              },
            },
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => {
        if (!state.activeProject || state.activeProject.id !== project.id) return {};
        return {
          activeProject: {
            ...state.activeProject,
            artifacts: {
              ...state.activeProject.artifacts,
              [id]: {
                ...state.activeProject.artifacts[id],
                lastWriteError: message,
              },
            },
          },
        };
      });
      throw error;
    }
  },

  resetProject: () => {
    for (const timer of writeTimers.values()) {
      window.clearTimeout(timer);
    }
    writeTimers.clear();
    set({ activeProject: null });
  },
}));
