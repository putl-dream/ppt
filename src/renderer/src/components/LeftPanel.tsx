import React from "react";
import type { SessionSummary } from "@shared/session";
import { PlusIcon, SettingsIcon, FileIcon, UserIcon, TrashIcon } from "./Icons";
import { ProjectNavigator } from "./ProjectNavigator";

interface LeftPanelProps {
  sessions: SessionSummary[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onToggleSettings: () => void;
  onDeleteSession: (id: string) => void;
}

export const LeftPanel: React.FC<LeftPanelProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onToggleSettings,
  onDeleteSession,
}) => {
  const [activeTab, setActiveTab] = React.useState<"pipeline" | "sessions">("pipeline");
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

  return (
    <aside className="left-panel">
      {/* 顶部新建会话 */}
      <div className="panel-header left-header">
        <div className="title-section">
          <span className="eyebrow">AGENT PPT</span>
          <h2 className="project-title" style={{ cursor: "default" }}>
            <span>工作台导航</span>
          </h2>
        </div>
        <button className="new-slide-btn" onClick={onNewSession} title="新建会话分支">
          <PlusIcon size={16} />
          <span>新建</span>
        </button>
      </div>

      {/* 选项卡导航 */}
      <div className="sidebar-tabs" style={{
        display: "flex",
        borderBottom: "1px solid var(--border-glass)",
        padding: "0 18px",
        gap: "12px",
        marginBottom: "8px"
      }}>
        <button
          onClick={() => setActiveTab("pipeline")}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: activeTab === "pipeline" ? "2px solid var(--accent-cyan)" : "2px solid transparent",
            color: activeTab === "pipeline" ? "var(--text-primary)" : "var(--text-muted)",
            padding: "8px 4px",
            fontSize: "12.5px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s ease"
          }}
        >
          项目产物
        </button>
        <button
          onClick={() => setActiveTab("sessions")}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: activeTab === "sessions" ? "2px solid var(--accent-cyan)" : "2px solid transparent",
            color: activeTab === "sessions" ? "var(--text-primary)" : "var(--text-muted)",
            padding: "8px 4px",
            fontSize: "12.5px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s ease"
          }}
        >
          历史分支
        </button>
      </div>

      {/* 纯粹的会话历史列表 或 项目路线图 */}
      <div className="sections-container flex-1" style={{ overflowY: "auto" }}>
        {activeTab === "pipeline" ? (
          <ProjectNavigator onToggleSettings={onToggleSettings} />
        ) : (
          <div className="history-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`history-card session-card ${
                  activeSessionId === session.id ? "active" : ""
                }`}
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
            ))}
          </div>
        )}
      </div>

      {/* 左下角固定的设置按钮 */}
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
