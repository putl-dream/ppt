import { create } from "zustand";

export type ArtifactId = "brief" | "outline" | "research" | "slides" | "design" | "deck";
export type ArtifactStatus = "draft" | "ready" | "stale";

export interface Artifact {
  id: ArtifactId;
  name: string;
  path: string;
  status: ArtifactStatus;
  version: string;
  content: string; // Markdown or JSON string
  upstreamDependencies: ArtifactId[];
  lastUpdatedBy: "user" | "agent";
  updatedAt: number;
}

export interface ProposedPatch {
  targetFile: string;
  op: string;
  patch: string;
  contentBefore: string;
  contentAfter: string;
  summary?: string;
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
  
  // Actions
  initializeProject: (id: string, name: string, backendArtifacts?: any[]) => void;
  setStage: (stage: ArtifactId) => void;
  updateArtifactContent: (id: ArtifactId, content: string, by?: "user" | "agent") => void;
  markStageReady: (id: ArtifactId) => void;
  proposePatch: (patch: ProposedPatch) => void;
  acceptPatch: () => void;
  rejectPatch: () => void;
  resetProject: () => void;
}

const DEFAULT_ARTIFACTS: Record<ArtifactId, Omit<Artifact, "content">> = {
  brief: {
    id: "brief",
    name: "目的、方向与受众 (Brief)",
    path: "brief.md",
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: [],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  outline: {
    id: "outline",
    name: "内容大纲 (Outline)",
    path: "outline.md",
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["brief"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  research: {
    id: "research",
    name: "资料与素材 (Research)",
    path: "research/notes.md",
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["outline"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  slides: {
    id: "slides",
    name: "逐页方案 (Slides Plan)",
    path: "slides/storyboard.json",
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["outline", "research", "design"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  design: {
    id: "design",
    name: "设计系统与偏好 (Design)",
    path: "design/theme.json",
    status: "draft",
    version: "1.0.0",
    upstreamDependencies: ["brief"],
    lastUpdatedBy: "user",
    updatedAt: Date.now(),
  },
  deck: {
    id: "deck",
    name: "PPT 预览与导出 (Deck)",
    path: "deck/snapshot.json",
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
  slides: JSON.stringify([
    { title: "封面页", layout: "cover", keyPoints: ["智能硬件市场推广", "主讲人: AI 助手"], quote: "无" },
    { title: "行业背景", layout: "concept", keyPoints: ["痛点一：获客成本高", "痛点二：转化率低"], quote: "行业数据：2026年市场增长率约为12%" },
    { title: "解决方案", layout: "comparison", keyPoints: ["以客户为中心的产品矩阵", "全渠道智能化触达"], quote: "无" },
  ], null, 2),
  design: JSON.stringify({
    theme: "nordic",
    palette: "cyan",
    logoUrl: null,
    ratio: "16:9",
  }, null, 2),
  deck: JSON.stringify({
    title: "新演示文稿",
    slidesCount: 3,
  }, null, 2),
};

const DEPENDENCY_MAP: Record<ArtifactId, ArtifactId[]> = {
  brief: ["outline", "design", "slides", "deck"],
  outline: ["slides", "deck"],
  research: ["slides"],
  design: ["deck"],
  slides: ["deck"],
  deck: [],
};

// Helper to update downstream statuses to 'stale'
const propagateStale = (
  artifacts: Record<ArtifactId, Artifact>,
  startId: ArtifactId
): Record<ArtifactId, Artifact> => {
  const nextArtifacts = { ...artifacts };
  const queue = [...(DEPENDENCY_MAP[startId] || [])];
  const visited = new Set<ArtifactId>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    nextArtifacts[current] = {
      ...nextArtifacts[current],
      status: "stale",
      updatedAt: Date.now(),
    };

    const nextDeps = DEPENDENCY_MAP[current] || [];
    queue.push(...nextDeps);
  }

  return nextArtifacts;
};

export const useProjectStore = create<ProjectState>((set) => ({
  activeProject: null,
  currentStage: "brief",
  proposedPatch: null,

  initializeProject: (id, name, backendArtifacts) => {
    const artifacts: Record<ArtifactId, Artifact> = {} as any;
    
    (Object.keys(DEFAULT_ARTIFACTS) as ArtifactId[]).forEach((key) => {
      let status: ArtifactStatus = "draft";
      if (backendArtifacts) {
        const matching = backendArtifacts.find((ba) => ba.kind === key || ba.id === key);
        if (matching) status = matching.status;
      }

      // Restore content from localStorage if available, else use default content
      const cachedContent = localStorage.getItem(`ppt_proj_${id}_art_${key}`);

      artifacts[key] = {
        ...DEFAULT_ARTIFACTS[key],
        status,
        content: cachedContent || DEFAULT_CONTENTS[key],
        updatedAt: Date.now(),
      };
    });

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

  setStage: (stage) => set({ currentStage: stage }),

  updateArtifactContent: (id, content, by = "user") => {
    set((state) => {
      if (!state.activeProject) return {};

      const currentArtifact = state.activeProject.artifacts[id];
      const updatedArtifact = {
        ...currentArtifact,
        content,
        lastUpdatedBy: by,
        updatedAt: Date.now(),
      };

      let newArtifacts = {
        ...state.activeProject.artifacts,
        [id]: updatedArtifact,
      };

      // Propagate stale status downstream if user edited it
      newArtifacts = propagateStale(newArtifacts, id);

      // Persist to localStorage
      localStorage.setItem(`ppt_proj_${state.activeProject.id}_art_${id}`, content);

      return {
        activeProject: {
          ...state.activeProject,
          artifacts: newArtifacts,
        },
      };
    });
  },

  markStageReady: (id) => {
    set((state) => {
      if (!state.activeProject) return {};

      const currentArtifact = state.activeProject.artifacts[id];
      const updatedArtifact = {
        ...currentArtifact,
        status: "ready" as const,
        updatedAt: Date.now(),
      };

      const newArtifacts = {
        ...state.activeProject.artifacts,
        [id]: updatedArtifact,
      };

      return {
        activeProject: {
          ...state.activeProject,
          artifacts: newArtifacts,
        },
      };
    });
  },

  proposePatch: (patch) => set({ proposedPatch: patch }),

  acceptPatch: () => {
    set((state) => {
      if (!state.activeProject || !state.proposedPatch) return {};
      const { targetFile, contentAfter } = state.proposedPatch;
      
      // Map filepath/target to ArtifactId
      let targetId: ArtifactId | null = null;
      if (targetFile.includes("brief")) targetId = "brief";
      else if (targetFile.includes("outline")) targetId = "outline";
      else if (targetFile.includes("research")) targetId = "research";
      else if (targetFile.includes("slides")) targetId = "slides";
      else if (targetFile.includes("design")) targetId = "design";
      else if (targetFile.includes("deck")) targetId = "deck";

      if (!targetId) return { proposedPatch: null };

      const currentArtifact = state.activeProject.artifacts[targetId];
      const updatedArtifact = {
        ...currentArtifact,
        content: contentAfter,
        status: "ready" as const, // auto-mark ready on accepted agent patch
        lastUpdatedBy: "agent" as const,
        updatedAt: Date.now(),
      };

      let newArtifacts = {
        ...state.activeProject.artifacts,
        [targetId]: updatedArtifact,
      };

      // Propagate stale status downstream
      newArtifacts = propagateStale(newArtifacts, targetId);

      // Save to cache
      localStorage.setItem(`ppt_proj_${state.activeProject.id}_art_${targetId}`, contentAfter);

      return {
        activeProject: {
          ...state.activeProject,
          artifacts: newArtifacts,
        },
        proposedPatch: null,
      };
    });
  },

  rejectPatch: () => set({ proposedPatch: null }),

  resetProject: () => set({ activeProject: null, proposedPatch: null, currentStage: "brief" }),
}));
