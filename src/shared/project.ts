import type { ProjectArtifact } from "./session";
import { projectArtifactFilePaths } from "./deck-persistence";

export const projectArtifactIds = [
  "design-spec",
  "template-policy",
  "page-plan",
  "page-svg",
  "assets",
  "deck",
  "export-history",
  "brief",
  "outline",
  "research",
] as const;
export type ProjectArtifactId = (typeof projectArtifactIds)[number];

/** 目录型 artifact 下的关键子文件路径 */
export { projectArtifactFilePaths };

export const defaultProjectArtifacts: ProjectArtifact[] = [
  {
    id: "design-spec",
    title: "设计规范",
    path: "design/design-spec.json",
    kind: "design-spec",
  },
  {
    id: "template-policy",
    title: "模板策略",
    path: "design/template-policy.json",
    kind: "template-policy",
  },
  {
    id: "page-plan",
    title: "逐页规划",
    path: "slides/page-plan.json",
    kind: "page-plan",
  },
  {
    id: "page-svg",
    title: "页面 SVG",
    path: "slides/svg/",
    kind: "page-svg",
  },
  {
    id: "assets",
    title: "本地素材",
    path: "assets/",
    kind: "assets",
  },
  {
    id: "deck",
    title: "已应用演示文稿",
    path: "deck/snapshot.json",
    kind: "deck",
  },
  {
    id: "export-history",
    title: "导出记录",
    path: "history/exports.json",
    kind: "export-history",
  },
  {
    id: "brief",
    title: "可选资料 · Brief",
    path: "brief.md",
    kind: "reference",
  },
  {
    id: "outline",
    title: "可选资料 · 大纲",
    path: "outline.md",
    kind: "reference",
  },
  {
    id: "research",
    title: "可选资料 · 研究与来源",
    path: "research/",
    kind: "reference",
  },
];

export const primaryProjectArtifactPaths: Record<ProjectArtifactId, string> = {
  "design-spec": "design/design-spec.json",
  "template-policy": "design/template-policy.json",
  "page-plan": "slides/page-plan.json",
  "page-svg": "slides/svg/",
  assets: "assets/",
  deck: "deck/snapshot.json",
  "export-history": "history/exports.json",
  brief: "brief.md",
  outline: "outline.md",
  research: "research/notes.md",
};

export function getPrimaryProjectArtifactPath(
  artifact: Pick<ProjectArtifact, "id" | "path">,
): string {
  if (isProjectArtifactId(artifact.id)) {
    return primaryProjectArtifactPaths[artifact.id];
  }
  return artifact.path;
}

export function isProjectArtifactId(value: string): value is ProjectArtifactId {
  return projectArtifactIds.includes(value as ProjectArtifactId);
}
