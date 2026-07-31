import { useEffect, useMemo, type KeyboardEvent } from "react";
import type {
  PptJobProjection,
  PptJobStatus,
  PptProposalStatus,
  PptStage,
} from "@shared/presentation-lifecycle";
import { CheckIcon, FileIcon, FolderIcon, RefreshIcon } from "./Icons";
import {
  formatProjectFileSize,
  groupProjectFiles,
} from "../app/project/projectFilesState";
import {
  useProjectFiles,
  type ProjectFilesController,
} from "../app/project/useProjectFiles";
import { useProjectStore } from "./project-store";

interface ProjectFilesPageProps {
  sessionId?: string;
  sessionTitle: string;
  workspaceLabel: string;
  busy: boolean;
  notify: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export interface ProjectFilesPageContentProps {
  controller: ProjectFilesController;
  hasSession: boolean;
  sessionTitle: string;
  workspaceLabel: string;
  busy: boolean;
  pptJob?: PptJobProjection | null;
}

const JOB_STATUS_LABELS: Record<PptJobStatus, string> = {
  running: "进行中",
  waiting_user: "等待用户",
  waiting_approval: "等待审批",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失败",
};

const PROPOSAL_STATUS_LABELS: Record<PptProposalStatus, string> = {
  waiting_approval: "等待审批",
  applied: "已应用",
  rejected: "已拒绝",
  superseded: "已失效",
};

const STAGE_LABELS: Record<PptStage, string> = {
  intent: "意图",
  design_spec: "设计规范",
  page_plan: "逐页规划",
  page_svg: "页面 SVG",
  preview: "预览",
  candidate: "候选稿",
  quality: "质量检查",
  proposal: "提案",
  presentation: "演示文稿",
  export: "导出",
};

function fileName(path: string): string {
  return path.split("/").at(-1) || path;
}

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.?\//, "");
}

function getLifecycleArtifactIds(
  path: string,
  pptJob: PptJobProjection,
): string[] {
  const normalizedPath = normalizeProjectPath(path);
  if (normalizedPath === "design/design-spec.json") return ["design-spec"];
  if (normalizedPath === "slides/page-plan.json") return ["page-plan"];
  if (normalizedPath.startsWith("slides/svg/") && normalizedPath.endsWith(".svg")) {
    return [`page-svg:${normalizedPath}`];
  }
  if (normalizedPath.startsWith("assets/")) {
    return [`source-asset:${normalizedPath}`];
  }
  if (normalizedPath === "deck/snapshot.json") {
    return pptJob.committedArtifacts
      .filter((artifact) => artifact.kind === "presentation_revision")
      .map((artifact) => artifact.artifactId);
  }
  if (normalizedPath === "history/exports.json") {
    return pptJob.committedArtifacts
      .filter(
        (artifact) =>
          artifact.kind === "export_artifact"
          && artifact.revisionId === pptJob.exportArtifactRevisionId,
      )
      .map((artifact) => artifact.artifactId);
  }
  return [];
}

function lifecycleArtifactBadge(
  path: string,
  pptJob: PptJobProjection | null,
): "committed" | "stale" | null {
  if (!pptJob) return null;
  const artifactIds = getLifecycleArtifactIds(path, pptJob);
  if (artifactIds.length === 0) return null;
  if (
    pptJob.staleArtifacts.some(
      (artifact) => artifactIds.includes(artifact.artifactId),
    )
  ) {
    return "stale";
  }
  return pptJob.committedArtifacts.some(
    (artifact) => artifactIds.includes(artifact.artifactId),
  )
    ? "committed"
    : null;
}

export function ProjectFilesPage({
  sessionId,
  sessionTitle,
  workspaceLabel,
  busy,
  notify,
  onDirtyChange,
}: ProjectFilesPageProps) {
  const controller = useProjectFiles({ sessionId, busy, notify });
  const pptJob = useProjectStore((state) => state.pptJob);

  useEffect(() => {
    onDirtyChange?.(controller.dirty);
  }, [controller.dirty, onDirtyChange]);

  useEffect(
    () => () => onDirtyChange?.(false),
    [onDirtyChange],
  );

  useEffect(() => {
    if (!controller.dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [controller.dirty]);

  return (
    <ProjectFilesPageContent
      controller={controller}
      hasSession={Boolean(sessionId)}
      sessionTitle={sessionTitle}
      workspaceLabel={workspaceLabel}
      busy={busy}
      pptJob={pptJob}
    />
  );
}

export function ProjectFilesPageContent({
  controller,
  hasSession,
  sessionTitle,
  workspaceLabel,
  busy,
  pptJob = null,
}: ProjectFilesPageContentProps) {
  const groups = useMemo(
    () => groupProjectFiles(controller.files, controller.artifacts),
    [controller.artifacts, controller.files],
  );
  const currentFile = controller.openedFile;
  const canEdit = Boolean(currentFile?.editable) && !controller.binary;
  const canSave = canEdit
    && controller.dirty
    && !busy
    && !controller.isSaving
    && !controller.requiresReload;
  const readOnlyReason = controller.binary
    ? "二进制文件不支持文本编辑。"
    : currentFile && !currentFile.editable
      ? currentFile.readOnlyReason || "该项目文件由系统管理，仅供查看。"
      : null;

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (canSave) void controller.save();
    }
  };

  return (
    <section className="project-files-page" aria-label="项目文件管理">
      <header className="project-files-header">
        <div className="project-files-heading">
          <span className="eyebrow">PROJECT FILES</span>
          <h1>项目文件</h1>
          <p>
            <span>{workspaceLabel}</span>
            <span aria-hidden="true">/</span>
            <span>{sessionTitle}</span>
          </p>
        </div>
        <button
          type="button"
          className="project-files-button project-files-button--icon"
          onClick={() => void controller.refresh()}
          disabled={!hasSession || controller.isLoadingProject}
          aria-label="刷新项目文件"
          title="刷新项目文件"
        >
          <RefreshIcon size={16} />
          <span>{controller.isLoadingProject ? "刷新中…" : "刷新"}</span>
        </button>
      </header>

      {hasSession && pptJob ? (
        <div className={`project-files-job-status is-${pptJob.status}`} role="status">
          <span className="project-files-job-status__label">PPT JOB</span>
          <strong>{JOB_STATUS_LABELS[pptJob.status]}</strong>
          <span>阶段：{STAGE_LABELS[pptJob.stage]}</span>
          {pptJob.proposalId && pptJob.proposalStatus ? (
            <span>
              Proposal：{PROPOSAL_STATUS_LABELS[pptJob.proposalStatus]}
            </span>
          ) : null}
          {pptJob.waitingReason ? (
            <span className="project-files-job-status__reason">{pptJob.waitingReason}</span>
          ) : null}
          {pptJob.staleArtifacts.length > 0 ? (
            <span className="project-files-job-status__stale">
              {pptJob.staleArtifacts.length} 个生命周期产物待更新
            </span>
          ) : null}
        </div>
      ) : null}

      {!hasSession ? (
        <div className="project-files-empty" role="status">
          <FolderIcon size={30} />
          <strong>还没有可浏览的项目</strong>
          <span>选择或创建会话后查看项目文件。</span>
        </div>
      ) : (
        <div className="project-files-body">
          <nav className="project-files-browser" aria-label="项目文件列表">
            <div className="project-files-browser-summary">
              <span>{controller.files.length} 个文件</span>
              {controller.isLoadingProject ? <span>正在读取…</span> : null}
            </div>
            <div className="project-files-groups">
              {groups.map((group) => (
                <details className="project-files-group" open key={group.id}>
                  <summary>
                    <FolderIcon size={14} />
                    <span className="project-files-group-title">{group.title}</span>
                    <span className="project-files-count">{group.files.length}</span>
                  </summary>
                  {group.files.length > 0 ? (
                    <div className="project-files-list">
                      {group.files.map((path) => {
                        const lifecycleBadge = lifecycleArtifactBadge(path, pptJob);
                        return (
                          <button
                            type="button"
                            key={path}
                            className={`project-files-file${controller.selectedPath === path ? " active" : ""}`}
                            onClick={() => void controller.selectFile(path)}
                            title={path}
                            aria-current={controller.selectedPath === path ? "page" : undefined}
                          >
                            <FileIcon size={14} />
                            <span>
                              <strong>{fileName(path)}</strong>
                              <small>{path}</small>
                            </span>
                            {lifecycleBadge ? (
                              <em
                                className={`project-files-artifact-badge is-${lifecycleBadge}`}
                              >
                                {lifecycleBadge === "stale" ? "待更新" : "已提交"}
                              </em>
                            ) : null}
                            {controller.selectedPath === path && controller.dirty ? (
                              <i aria-label="有未保存修改" title="有未保存修改" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="project-files-group-empty">
                      {group.rootPath || "暂无文件"}
                    </div>
                  )}
                </details>
              ))}
              {!controller.isLoadingProject && groups.length === 0 ? (
                <div className="project-files-group-empty">项目中暂无文件。</div>
              ) : null}
            </div>
          </nav>

          <main className="project-files-editor">
            {busy ? (
              <div className="project-files-notice is-busy" role="status">
                Agent 正在运行；你仍可浏览文件，但保存暂不可用。
              </div>
            ) : null}

            {controller.error ? (
              <div className="project-files-notice is-error" role="alert">
                <span>{controller.error}</span>
                {controller.requiresReload ? (
                  <button type="button" onClick={() => void controller.reloadSelected()}>
                    重新载入
                  </button>
                ) : null}
              </div>
            ) : null}
            {controller.requiresReload && !controller.error ? (
              <div className="project-files-notice is-error" role="alert">
                <span>当前编辑会话已失效，草稿仍在。请重新载入磁盘版本后再保存。</span>
                <button type="button" onClick={() => void controller.reloadSelected()}>
                  重新载入
                </button>
              </div>
            ) : null}

            {!controller.selectedPath ? (
              <div className="project-files-empty is-editor">
                <FileIcon size={30} />
                <strong>选择文件开始查看</strong>
                <span>文本文件可在这里编辑、比较差异并安全保存。</span>
              </div>
            ) : controller.binary ? (
              <div className="project-files-empty is-editor" role="status">
                <FileIcon size={30} />
                <strong>{fileName(controller.selectedPath)}</strong>
                <span>{readOnlyReason}</span>
                <code>{controller.selectedPath}</code>
              </div>
            ) : controller.isOpening ? (
              <div className="project-files-empty is-editor" role="status">
                正在打开文件…
              </div>
            ) : currentFile ? (
              <>
                <div className="project-files-editor-header">
                  <div>
                    <h2>
                      {fileName(currentFile.path)}
                      {controller.dirty ? <span className="project-files-dirty">未保存</span> : null}
                    </h2>
                    <p title={currentFile.path}>{currentFile.path}</p>
                  </div>
                  <div className="project-files-metadata" aria-label="文件元数据">
                    <span>{formatProjectFileSize(currentFile.size)}</span>
                    <span>{currentFile.newline.toUpperCase()}</span>
                    <span title={currentFile.version}>
                      版本 {currentFile.version.replace(/^sha256:/, "").slice(0, 8)}
                    </span>
                  </div>
                </div>

                {readOnlyReason ? (
                  <div className="project-files-notice" role="status">{readOnlyReason}</div>
                ) : null}

                <div className="project-files-toolbar" role="toolbar" aria-label="文件编辑操作">
                  <button
                    type="button"
                    className="project-files-button"
                    onClick={() => void controller.reloadSelected()}
                    disabled={controller.isOpening || controller.isSaving}
                  >
                    重新载入
                  </button>
                  <button
                    type="button"
                    className="project-files-button"
                    onClick={controller.discardDraft}
                    disabled={!controller.dirty || controller.isSaving}
                  >
                    放弃修改
                  </button>
                  <button
                    type="button"
                    className="project-files-button"
                    onClick={() => void controller.requestDiff()}
                    disabled={controller.isLoadingDiff || controller.isSaving}
                  >
                    {controller.isLoadingDiff ? "比较中…" : "查看差异"}
                  </button>
                  <button
                    type="button"
                    className="project-files-button is-primary"
                    onClick={() => void controller.save()}
                    disabled={!canSave}
                    title={busy ? "Agent 运行期间不可保存" : undefined}
                  >
                    <CheckIcon size={14} />
                    {controller.isSaving ? "保存中…" : "保存"}
                  </button>
                </div>

                <textarea
                  className="project-files-textarea"
                  aria-label={`编辑 ${currentFile.path}`}
                  value={controller.draft}
                  readOnly={!canEdit}
                  spellCheck={false}
                  onChange={(event) => controller.setDraft(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                />

                {controller.diff ? (
                  <section className="project-files-diff" aria-label="文件差异">
                    <div>
                      <strong>与磁盘版本的差异</strong>
                      <span>{controller.diff.changed ? "有修改" : "无修改"}</span>
                    </div>
                    <pre>{controller.diff.unifiedDiff || "当前内容与磁盘版本一致。"}</pre>
                  </section>
                ) : null}
              </>
            ) : (
              <div className="project-files-empty is-editor" role="alert">
                文件未能打开，请刷新后重试。
              </div>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
