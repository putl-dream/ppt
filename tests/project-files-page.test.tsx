import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectArtifact } from "../src/shared/session";
import type { ProjectFilesController } from "../src/renderer/src/app/project/useProjectFiles";
import { LeftPanel } from "../src/renderer/src/components/LeftPanel";
import { ProjectFilesPageContent } from "../src/renderer/src/components/ProjectFilesPage";

const ARTIFACTS: ProjectArtifact[] = [
  {
    id: "brief",
    title: "需求简报",
    path: "brief.md",
    kind: "brief",
    status: "ready",
    dependsOn: [],
  },
  {
    id: "deck",
    title: "演示文稿",
    path: "deck/",
    kind: "deck",
    status: "draft",
    dependsOn: ["brief"],
  },
  {
    id: "history",
    title: "历史版本",
    path: "history/",
    kind: "history",
    status: "stale",
    dependsOn: [],
  },
];

function createController(
  overrides: Partial<ProjectFilesController> = {},
): ProjectFilesController {
  return {
    artifacts: [],
    files: [],
    selectedPath: null,
    openedFile: null,
    draft: "",
    diff: null,
    dirty: false,
    binary: false,
    isLoadingProject: false,
    isOpening: false,
    isSaving: false,
    isLoadingDiff: false,
    error: null,
    requiresReload: false,
    refresh: vi.fn(async () => undefined),
    selectFile: vi.fn(async () => undefined),
    reloadSelected: vi.fn(async () => undefined),
    setDraft: vi.fn(),
    discardDraft: vi.fn(),
    requestDiff: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ProjectFilesPageContent", () => {
  it("shows a clear empty state when no session is active", () => {
    const html = renderToStaticMarkup(
      <ProjectFilesPageContent
        controller={createController()}
        hasSession={false}
        sessionTitle="AI 新建会话"
        workspaceLabel="未选择目录"
        busy={false}
      />,
    );

    expect(html).toContain("选择或创建会话后查看项目文件");
    expect(html).toContain("disabled");
  });

  it("renders artifact groups, an editable draft, diff, and metadata", () => {
    const html = renderToStaticMarkup(
      <ProjectFilesPageContent
        controller={createController({
          artifacts: ARTIFACTS,
          files: ["brief.md", "deck/deck.json"],
          selectedPath: "brief.md",
          openedFile: {
            path: "brief.md",
            content: "# 原始简报",
            version: "0123456789abcdef",
            mtimeMs: 1_700_000_000_000,
            size: 24,
            encoding: "utf8",
            newline: "lf",
            editToken: "edit-token",
            editable: true,
          },
          draft: "# 更新简报",
          dirty: true,
          diff: {
            path: "brief.md",
            before: "# 原始简报",
            after: "# 更新简报",
            changed: true,
            unifiedDiff: "-# 原始简报\n+# 更新简报",
          },
        })}
        hasSession
        sessionTitle="季度汇报"
        workspaceLabel="Acme"
        busy={false}
      />,
    );

    expect(html).toContain("需求简报");
    expect(html).toContain("演示文稿");
    expect(html).toContain("历史版本");
    expect(html).toContain("brief.md");
    expect(html).toContain("# 更新简报");
    expect(html).toContain("与磁盘版本的差异");
    expect(html).toContain("未保存");
    expect(html).not.toContain("readOnly");

    const saveButton = html.match(
      /<button[^>]*class="project-files-button is-primary"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];
    expect(saveButton).toBeDefined();
    expect(saveButton).not.toContain("disabled");
  });

  it("allows browsing but disables saving while the agent is running", () => {
    const html = renderToStaticMarkup(
      <ProjectFilesPageContent
        controller={createController({
          artifacts: ARTIFACTS,
          files: ["brief.md"],
          selectedPath: "brief.md",
          openedFile: {
            path: "brief.md",
            content: "before",
            version: "version",
            mtimeMs: 1,
            size: 6,
            encoding: "utf8",
            newline: "none",
            editToken: "token",
            editable: true,
          },
          draft: "after",
          dirty: true,
        })}
        hasSession
        sessionTitle="季度汇报"
        workspaceLabel="Acme"
        busy
      />,
    );

    expect(html).toContain("你仍可浏览文件，但保存暂不可用");
    expect(html).toContain('title="Agent 运行期间不可保存"');
    const saveButton = html.match(
      /<button[^>]*class="project-files-button is-primary"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];
    expect(saveButton).toContain("disabled");
  });

  it("honors backend read-only metadata and blocks binary files in the UI", () => {
    const readOnlyHtml = renderToStaticMarkup(
      <ProjectFilesPageContent
        controller={createController({
          artifacts: ARTIFACTS,
          files: ["deck/deck.json"],
          selectedPath: "deck/deck.json",
          openedFile: {
            path: "deck/deck.json",
            content: "{}",
            version: "version",
            mtimeMs: 1,
            size: 2,
            encoding: "utf8",
            newline: "none",
            editToken: "token",
            editable: false,
            readOnlyReason: "Deck 文件由演示文稿流水线管理。",
          },
          draft: "{}",
        })}
        hasSession
        sessionTitle="季度汇报"
        workspaceLabel="Acme"
        busy={false}
      />,
    );
    expect(readOnlyHtml).toContain("Deck 文件由演示文稿流水线管理");
    expect(readOnlyHtml).toContain('readOnly=""');

    const binaryHtml = renderToStaticMarkup(
      <ProjectFilesPageContent
        controller={createController({
          artifacts: ARTIFACTS,
          files: ["deck/final.pptx"],
          selectedPath: "deck/final.pptx",
          binary: true,
        })}
        hasSession
        sessionTitle="季度汇报"
        workspaceLabel="Acme"
        busy={false}
      />,
    );
    expect(binaryHtml).toContain("二进制文件不支持文本编辑");
    expect(binaryHtml).not.toContain("<textarea");
  });

  it("keeps reload guidance visible after a failed edit session", () => {
    const html = renderToStaticMarkup(
      <ProjectFilesPageContent
        controller={createController({
          artifacts: ARTIFACTS,
          files: ["brief.md"],
          selectedPath: "brief.md",
          openedFile: {
            path: "brief.md",
            content: "before",
            version: "version",
            mtimeMs: 1,
            size: 6,
            encoding: "utf8",
            newline: "none",
            editToken: "expired-token",
            editable: true,
          },
          draft: "preserved draft",
          dirty: true,
          requiresReload: true,
        })}
        hasSession
        sessionTitle="季度汇报"
        workspaceLabel="Acme"
        busy={false}
      />,
    );

    expect(html).toContain("当前编辑会话已失效，草稿仍在");
    expect(html).toContain("重新载入");
    const saveButton = html.match(
      /<button[^>]*class="project-files-button is-primary"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];
    expect(saveButton).toContain("disabled");
  });
});

describe("LeftPanel project file navigation", () => {
  const commonProps = {
    sessions: [],
    activeSessionId: "",
    onSelectSession: vi.fn(),
    onNewSession: vi.fn(),
    onNewSessionInWorkspace: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onOpenFiles: vi.fn(),
    onToggleSettings: vi.fn(),
    onDeleteSession: vi.fn(),
    onToggleCollapsed: vi.fn(),
  };

  it("shows project files in expanded and rail navigation", () => {
    const expanded = renderToStaticMarkup(
      <LeftPanel {...commonProps} activeMode="files" collapsed={false} />,
    );
    expect(expanded).toContain("Agent 工作区");
    expect(expanded).toContain("项目文件");
    expect(expanded).toContain('aria-current="page"');

    const rail = renderToStaticMarkup(
      <LeftPanel {...commonProps} activeMode="files" collapsed />,
    );
    expect(rail).toContain('aria-label="项目文件"');
    expect(rail).toContain('aria-current="page"');
  });
});
