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

export interface ProposedPatch {
  targetFile: string;
  op: string;
  patch: string;
  contentBefore: string;
  contentAfter: string;
  summary?: string;
  threadId?: string;
}

export interface ActiveProject {
  id: string;
  name: string;
  currentStage: ArtifactId;
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
  currentStage: ArtifactId;
  proposedPatch: ProposedPatch | null;

  initializeProject: (id: string, name: string, backendArtifacts?: ProjectArtifact[]) => void;
  hydrateProjectArtifacts: (sessionId?: string) => Promise<void>;
  setStage: (stage: ArtifactId) => void;
  updateArtifactContent: (id: ArtifactId, content: string, by?: "user" | "agent") => void;
  markStageReady: (id: ArtifactId) => void;
  proposePatch: (patch: ProposedPatch) => void;
  acceptPatch: () => void;
  rejectPatch: () => void;
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

const DEFAULT_CONTENTS: Record<ArtifactId, string> = {
  brief: `# 演示文稿 Brief\n\n- **项目名称**: 新演示文稿\n- **核心目的**: 汇报\n- **目标听众**: 团队成员\n- **演讲时长**: 20分钟\n- **讲稿配置**: 需要\n- **期望风格**: 专业简洁\n`,
  outline: `# 演示大纲\n\n## 1. 行业背景与痛点 [预计 1 页]\n- 行业增速放缓\n- 痛点分析\n\n## 2. 解决方案 [预计 1 页]\n- 产品定位\n- 核心竞争力\n\n## 3. 发展规划 [预计 1 页]\n- 下一步里程碑\n- 商业价值\n`,
  research: `# 研究资料与素材\n\n- **行业数据**: 2026年市场增长率约为12%。\n- **竞品分析**: A产品优势在价格，B产品优势在服务。\n`,
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
  design: JSON.stringify(
    {
      tone: "professional",
      typography: {
        heading: "system-ui",
        body: "system-ui",
      },
      palette: {
        primary: "#2563eb",
        accent: "#10b981",
        background: "#f8fafc",
        text: "#111827",
      },
      layout: {
        ratio: "16:9",
        density: "balanced",
      },
    },
    null,
    2,
  ),
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

function findArtifactIdByPath(targetFile: string): ArtifactId | undefined {
  const normalized = targetFile.replace(/\\/g, "/");
  return projectStageIds.find((id) => {
    const primaryPath = primaryProjectArtifactPaths[id];
    return normalized === primaryPath || normalized.includes(id) || normalized.startsWith(`${id}/`);
  });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProject: null,
  currentStage: "brief",
  proposedPatch: null,

  initializeProject: (id, name, backendArtifacts) => {
    const artifacts = Object.fromEntries(
      projectStageIds.map((stageId) => [stageId, createArtifactShell(stageId, backendArtifacts)]),
    ) as Record<ArtifactId, Artifact>;

    set({
      activeProject: {
        id,
        name,
        currentStage: "brief",
        artifacts,
        history: [],
      },
      currentStage: "brief",
      proposedPatch: null,
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

  setStage: (stage) => set((state) => ({
    currentStage: stage,
    activeProject: state.activeProject
      ? {
          ...state.activeProject,
          currentStage: stage,
        }
      : state.activeProject,
  })),

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

  markStageReady: (id) => {
    const project = get().activeProject;
    if (!project) return;

    set((state) => {
      if (!state.activeProject) return {};
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

    const api = getDesktopApi();
    if (!api || project.id === "draft_id") return;

    const artifact = project.artifacts[id];
    const timerKey = `${project.id}:${id}`;
    const existingTimer = writeTimers.get(timerKey);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      writeTimers.delete(timerKey);
    }

    void api
      .writeProjectArtifact(project.id, artifact.path, artifact.content)
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
        return api.markProjectArtifactStatus(project.id, id, "ready");
      })
      .then((artifact: ProjectArtifact) => {
        set((state) => {
          if (!state.activeProject || state.activeProject.id !== project.id) return {};
          return {
            activeProject: {
              ...state.activeProject,
              artifacts: {
                ...state.activeProject.artifacts,
                [id]: {
                  ...state.activeProject.artifacts[id],
                  status: artifact.status,
                  updatedAt: Date.now(),
                },
              },
            },
          };
        });
      })
      .catch((error: unknown) => {
        console.error(`标记项目产物状态失败: ${id}`, error);
      });
  },

  proposePatch: (patch) => set({ proposedPatch: patch }),

  acceptPatch: async () => {
    const state = get();
    if (!state.activeProject || !state.proposedPatch) return;
    const targetId = findArtifactIdByPath(state.proposedPatch.targetFile);
    const contentAfter = state.proposedPatch.contentAfter;
    const threadId = state.proposedPatch.threadId;
    set({ proposedPatch: null });
    if (!targetId) return;
    get().updateArtifactContent(targetId, contentAfter, "agent");

    const api = getDesktopApi();
    if (api && threadId) {
      try {
        await api.resumeAgentRun(threadId, true);
      } catch (error) {
        console.error("Failed to resume agent run after accepting patch:", error);
      }
    }
  },

  rejectPatch: async () => {
    const state = get();
    if (!state.proposedPatch) return;
    const threadId = state.proposedPatch.threadId;
    set({ proposedPatch: null });

    const api = getDesktopApi();
    if (api && threadId) {
      try {
        await api.resumeAgentRun(threadId, false);
      } catch (error) {
        console.error("Failed to resume agent run after rejecting patch:", error);
      }
    }
  },

  resetProject: () => {
    for (const timer of writeTimers.values()) {
      window.clearTimeout(timer);
    }
    writeTimers.clear();
    set({ activeProject: null, proposedPatch: null, currentStage: "brief" });
  },
}));
