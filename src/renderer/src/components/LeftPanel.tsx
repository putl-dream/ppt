import React from "react";
import type { SessionSummary } from "@shared/session";
import { PlusIcon, SettingsIcon, FileIcon, UserIcon } from "./Icons";

interface LeftPanelProps {
  sessions: SessionSummary[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onToggleSettings: () => void;
}

export const LeftPanel: React.FC<LeftPanelProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onToggleSettings,
}) => {
  return (
    <aside className="left-panel">
      {/* 顶部新建会话 */}
      <div className="panel-header left-header">
        <div className="title-section">
          <span className="eyebrow">AGENT PPT</span>
          <h2 className="project-title" style={{ cursor: "default" }}>
            <span>会话管理</span>
          </h2>
        </div>
        <button className="new-slide-btn" onClick={onNewSession} title="新建会话分支">
          <PlusIcon size={16} />
          <span>新建会话</span>
        </button>
      </div>

      {/* 纯粹的会话历史列表 */}
      <div className="sections-container flex-1">
        <div className="history-list">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`history-card session-card ${
                activeSessionId === session.id ? "active" : ""
              }`}
              onClick={() => onSelectSession(session.id)}
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
    </aside>
  );
};
