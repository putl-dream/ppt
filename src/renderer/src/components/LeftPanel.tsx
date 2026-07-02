import React from "react";
import type { SessionSummary } from "@shared/session";
import { getWorkspaceLabel, groupSessionsByWorkspace, sessionsForWorkspace } from "@shared/workspace";
import { PlusIcon, SettingsIcon, FileIcon, UserIcon, TrashIcon, FolderIcon } from "./Icons";

interface LeftPanelProps {
  sessions: SessionSummary[];
  activeSessionId: string;
  workspacePath?: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenWorkspace: () => void;
  onToggleSettings: () => void;
  onDeleteSession: (id: string) => void;
}

function SessionCard({
  session,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  setContextMenu,
}: {
  session: SessionSummary;
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  setContextMenu: (menu: { x: number; y: number; sessionId: string } | null) => void;
}) {
  return (
    <div
      key={session.id}
      className={`history-card session-card ${activeSessionId === session.id ? "active" : ""}`}
      onClick={() => onSelectSession(session.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          sessionId: session.id,
        });
      }}
    >
      <div className="history-card-header">
        <span className="history-ver">Rev {session.revision}</span>
        <span className="history-time">
          {new Date(session.updatedAt).toLocaleString([], {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="history-card-title flex items-center gap-2">
        <FileIcon size={14} className="text-muted" />
        <span className="truncate">{session.title}</span>
      </div>
      <div className="history-snapshot" style={{ marginTop: 6, justifyContent: "flex-end" }}>
        <span className="slide-count-badge">{session.slideCount} 页幻灯片</span>
      </div>
    </div>
  );
}

export const LeftPanel: React.FC<LeftPanelProps> = ({
  sessions,
  activeSessionId,
  workspacePath,
  onSelectSession,
  onNewSession,
  onOpenWorkspace,
  onToggleSettings,
  onDeleteSession,
}) => {
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);

  React.useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, []);

  const workspaceLabel = getWorkspaceLabel(workspacePath);
  const workspaceSessions = sessionsForWorkspace(sessions, workspacePath);
  const groupedSessions = workspacePath ? [] : groupSessionsByWorkspace(sessions);

  return (
    <aside className="left-panel">
      <div className="panel-header left-header">
        <div className="title-section" style={{ minWidth: 0, flex: 1 }}>
          <span className="eyebrow">AGENT PPT</span>
          <h2 className="project-title" style={{ cursor: "default" }} title={workspacePath}>
            <span>{workspaceLabel}</span>
          </h2>
          {workspacePath ? (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "11px",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={workspacePath}
            >
              {workspacePath}
            </p>
          ) : (
            <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
              打开项目目录后开始创作
            </p>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0 }}>
          <button
            className="new-slide-btn"
            onClick={onOpenWorkspace}
            title="打开项目目录"
            style={{ padding: "6px 10px" }}
          >
            <FolderIcon size={16} />
          </button>
          <button
            className="new-slide-btn"
            onClick={onNewSession}
            title="在当前目录新建对话"
            disabled={!workspacePath}
            style={{ opacity: workspacePath ? 1 : 0.5 }}
          >
            <PlusIcon size={16} />
            <span>新建</span>
          </button>
        </div>
      </div>

      <div
        className="sections-container flex-1"
        style={{ overflowY: "auto", paddingTop: "4px" }}
      >
        {workspacePath ? (
          <div className="history-list">
            {workspaceSessions.length === 0 ? (
              <p
                style={{
                  padding: "16px 18px",
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                }}
              >
                当前目录还没有对话。点击「新建」开始第一条创作对话。
              </p>
            ) : (
              workspaceSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  activeSessionId={activeSessionId}
                  onSelectSession={onSelectSession}
                  onDeleteSession={onDeleteSession}
                  setContextMenu={setContextMenu}
                />
              ))
            )}
          </div>
        ) : (
          <div className="history-list">
            {groupedSessions.length === 0 ? (
              <p
                style={{
                  padding: "16px 18px",
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                }}
              >
                暂无项目。点击文件夹图标打开项目目录。
              </p>
            ) : (
              groupedSessions.map((group) => (
                <div key={group.workspacePath} style={{ marginBottom: "12px" }}>
                  <div
                    style={{
                      padding: "8px 18px 6px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                    title={group.workspacePath === "__unknown__" ? undefined : group.workspacePath}
                  >
                    {group.workspacePath === "__unknown__"
                      ? "未关联目录"
                      : getWorkspaceLabel(group.workspacePath)}
                  </div>
                  {group.sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      activeSessionId={activeSessionId}
                      onSelectSession={onSelectSession}
                      onDeleteSession={onDeleteSession}
                      setContextMenu={setContextMenu}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="panel-footer left-footer flex justify-between items-center" style={{ padding: "12px 18px" }}>
        <div className="profile-badge flex-1">
          <div className="avatar-mock">
            <UserIcon size={16} />
          </div>
          <div className="profile-info">
            <div className="profile-name">PPT 创作者</div>
            <div className="profile-tier">AI 协同版</div>
          </div>
        </div>
        <button
          className="action-icon-btn settings-cog-btn"
          onClick={onToggleSettings}
          title="系统设置 (API Key, 导出选项等)"
          style={{ background: "transparent", border: "none" }}
        >
          <SettingsIcon size={18} className="text-secondary hover:text-primary transition-colors" />
        </button>
      </div>

      {contextMenu && (
        <div
          className="custom-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="custom-context-menu-item danger"
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu(null);
              onDeleteSession(contextMenu.sessionId);
            }}
          >
            <TrashIcon size={14} />
            <span>删除会话</span>
          </div>
        </div>
      )}
    </aside>
  );
};
