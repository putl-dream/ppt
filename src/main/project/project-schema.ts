import { join } from "node:path";
import type { Presentation } from "@shared/presentation";
import type { ProjectSandbox, SessionSnapshot } from "@shared/session";
import { defaultProjectArtifacts } from "@shared/project";
import {
  createDefaultBriefMarkdown,
  createDefaultBrandProfile,
  createDefaultProjectDesignSystem,
  createDefaultOutlineMarkdown,
  createDefaultResearchMarkdown,
  serializeProjectDesignSystem,
  serializeBrandProfile,
} from "@shared/project-artifacts";
import {
  createDefaultDesignConstraints,
  createDefaultExportHistoryFile,
  createDefaultGenerationJobsFile,
} from "@shared/deck-persistence";
import { createDefaultStoryboardSlide } from "@shared/storyboard";

export interface ProjectFileTemplate {
  path: string;
  content: string;
}

export function createProjectSandbox(
  snapshot: SessionSnapshot,
  projectRootPath: string,
): ProjectSandbox {
  const rootPath =
    snapshot.project?.rootPath ?? join(projectRootPath, `session-${snapshot.session.id}`);
  const existingStatusById = new Map(
    snapshot.project?.artifacts.map((artifact) => [artifact.id, artifact.status]),
  );
  const artifacts = defaultProjectArtifacts.map((artifact) => ({
    ...artifact,
    status: existingStatusById.get(artifact.id) ?? artifact.status,
  }));

  return { rootPath, artifacts };
}

export function createDefaultProjectFiles(snapshot: SessionSnapshot): ProjectFileTemplate[] {
  return [
    {
      path: "brief.md",
      content: createBriefTemplate(snapshot.session.title),
    },
    {
      path: "outline.md",
      content: createOutlineTemplate(snapshot.session.title),
    },
    {
      path: "research/sources.md",
      content: createResearchSourcesTemplate(),
    },
    {
      path: "research/notes.md",
      content: createResearchNotesTemplate(),
    },
    {
      path: "research/assets/.gitkeep",
      content: "",
    },
    {
      path: "slides/README.md",
      content: createSlidesReadmeTemplate(),
    },
    {
      path: "slides/001-title.md",
      content: createTitleSlideTemplate(snapshot.session.title),
    },
    {
      path: "slides/storyboard.json",
      content: `${JSON.stringify(createStoryboardTemplate(snapshot.session.title), null, 2)}\n`,
    },
    {
      path: "design/system.json",
      content: serializeProjectDesignSystem(createDesignSystemTemplate()),
    },
    {
      path: "design/brand-profile.json",
      content: serializeBrandProfile(createDefaultBrandProfile(snapshot.session.title)),
    },
    {
      path: "design/constraints.json",
      content: `${JSON.stringify(createDesignConstraintsTemplate(), null, 2)}\n`,
    },
    {
      path: "design/layout-notes.md",
      content: createLayoutNotesTemplate(),
    },
    {
      path: "deck/snapshot.json",
      content: `${JSON.stringify(snapshot.presentation, null, 2)}\n`,
    },
    {
      path: "deck/generation-jobs.json",
      content: `${JSON.stringify(createGenerationJobsTemplate(), null, 2)}\n`,
    },
    {
      path: "history/README.md",
      content: createHistoryReadmeTemplate(),
    },
    {
      path: "history/exports.json",
      content: `${JSON.stringify(createExportHistoryTemplate(), null, 2)}\n`,
    },
  ];
}

export function createDeckSnapshotContent(presentation: Presentation): string {
  return `${JSON.stringify(presentation, null, 2)}\n`;
}

function createBriefTemplate(title: string): string {
  return createDefaultBriefMarkdown(title);
}

function createOutlineTemplate(title: string): string {
  return createDefaultOutlineMarkdown(title);
}

function createResearchSourcesTemplate(): string {
  return `# Sources

记录外部资料、链接、访谈、数据来源和使用约束。
`;
}

function createResearchNotesTemplate(): string {
  return createDefaultResearchMarkdown();
}

function createSlidesReadmeTemplate(): string {
  return `# Slide Plans

每页一个 Markdown 文件，例如 \`001-title.md\`。记录页面目标、内容要点、素材引用和设计意图。
`;
}

function createTitleSlideTemplate(title: string): string {
  return `# 001 - 标题页

## 页面目标
- 建立主题和语境。

## 内容
- 标题：${title}
- 副标题：

## 设计意图
- 清晰表达主题，避免在封面堆叠过多信息。

## 依赖素材
- 
`;
}

function createDesignSystemTemplate() {
  return createDefaultProjectDesignSystem();
}

function createDesignConstraintsTemplate() {
  return createDefaultDesignConstraints();
}

function createGenerationJobsTemplate() {
  return createDefaultGenerationJobsFile();
}

function createExportHistoryTemplate() {
  return createDefaultExportHistoryFile();
}

function createStoryboardTemplate(title: string) {
  return [createDefaultStoryboardSlide(title, 0)];
}

function createLayoutNotesTemplate(): string {
  return `# Layout Notes

- 每页先明确一个信息任务，再选择版式。
- 内容页优先保证扫描效率和层级清晰。
- 图表、图片和表格必须能追溯到 \`research/\` 中的来源。
`;
}

function createHistoryReadmeTemplate(): string {
  return `# History

记录关键版本、决策变化和重要导出结果。不要在这里存放密钥或临时凭证。
`;
}
