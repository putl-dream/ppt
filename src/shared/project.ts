import type { ProjectArtifact } from "./session";
import { projectArtifactFilePaths } from "./deck-persistence";

export const projectStageIds = ["brief", "outline", "research", "slides", "design", "deck"] as const;
export type ProjectStageId = (typeof projectStageIds)[number];

/** 目录型 artifact 下的关键子文件路径 */
export { projectArtifactFilePaths };

export const defaultProjectArtifacts: ProjectArtifact[] = [
  {
    id: "brief",
    title: "目的、方向与受众",
    path: "brief.md",
    kind: "brief",
    status: "draft",
    dependsOn: [],
  },
  {
    id: "outline",
    title: "内容大纲",
    path: "outline.md",
    kind: "outline",
    status: "draft",
    dependsOn: ["brief"],
  },
  {
    id: "research",
    title: "资料与素材",
    path: "research/",
    kind: "research",
    status: "draft",
    dependsOn: ["outline"],
  },
  {
    id: "slides",
    title: "逐页内容与设计方案",
    path: "slides/",
    kind: "slide-plan",
    status: "draft",
    dependsOn: ["outline", "research", "design"],
  },
  {
    id: "design",
    title: "设计系统与版式偏好",
    path: "design/",
    kind: "design",
    status: "draft",
    dependsOn: ["brief"],
  },
  {
    id: "deck",
    title: "PPT 结构化快照与导出物",
    path: "deck/",
    kind: "deck",
    status: "draft",
    dependsOn: ["slides", "design"],
  },
  {
    id: "history",
    title: "关键版本记录",
    path: "history/",
    kind: "history",
    status: "draft",
    dependsOn: ["brief", "outline", "slides", "deck"],
  },
];

export const primaryProjectArtifactPaths: Record<ProjectStageId, string> = {
  brief: "brief.md",
  outline: "outline.md",
  research: "research/notes.md",
  slides: "slides/storyboard.json",
  design: "design/theme.json",
  deck: "deck/snapshot.json",
};

export function getPrimaryProjectArtifactPath(
  artifact: Pick<ProjectArtifact, "id" | "path">,
): string {
  if (isProjectStageId(artifact.id)) {
    return primaryProjectArtifactPaths[artifact.id];
  }
  return artifact.path;
}

export function isProjectStageId(value: string): value is ProjectStageId {
  return projectStageIds.includes(value as ProjectStageId);
}
