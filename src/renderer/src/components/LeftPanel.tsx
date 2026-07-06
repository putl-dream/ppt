import React from "react";
import type { SessionSummary } from "@shared/session";
import { getWorkspaceLabel, groupSessionsByWorkspace } from "@shared/workspace";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  TrashIcon,
  FolderIcon,
} from "./Icons";

interface LeftPanelProps {
  sessions: SessionSummary[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onNewSessionInWorkspace: (workspacePath: string) => void;
  onToggleSettings: () => void;
  onDeleteSession: (id: string) => void;
}

function SessionRow({
  session,
  isActive,
  onSelect,
  onContextMenu,
}: {
  session: SessionSummary;
  isActive: boolean;
  onSelect: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={`cursor-session-row ${isActive ? "active" : ""}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={session.title}
    >
      <span className="cursor-session-title">{session.title}</span>
    </button>
  );
}

function WorkspaceSection({
  workspaceKey,
  workspaceSessions,
  activeSessionId,
  onNewSessionInWorkspace,
  onSelectSession,
  onContextMenu,
}: {
  workspaceKey: string;
  workspaceSessions: SessionSummary[];
  activeSessionId: string;
  onNewSessionInWorkspace: (workspacePath: string) => void;
  onSelectSession: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, sessionId: string) => void;
}) {
  const label = getWorkspaceLabel(workspaceKey);
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const toggleCollapsed = () => setIsCollapsed((value) => !value);

  return (
    <div className="cursor-workspace-section">
      <div
        className="cursor-workspace-header"
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        title={workspaceKey}
        onClick={toggleCollapsed}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleCollapsed();
          }
        }}
      >
        <FolderIcon size={14} className="cursor-workspace-icon" />
        <span className="cursor-workspace-label">{label}</span>
        <span
          className="cursor-workspace-toggle-btn"
          title={isCollapsed ? "打开文件夹" : "折叠文件夹"}
          aria-hidden="true"
        >
          {isCollapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
        </span>
        <button
          type="button"
          className="cursor-workspace-add-btn"
          title="在此目录下新建会话"
          onClick={(event) => {
            event.stopPropagation();
            onNewSessionInWorkspace(workspaceKey);
          }}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {!isCollapsed ? (
        <div className="cursor-session-list">
          {workspaceSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              onSelect={() => onSelectSession(session.id)}
              onContextMenu={(event) => onContextMenu(event, session.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const LeftPanel: React.FC<LeftPanelProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onNewSessionInWorkspace,
  onToggleSettings,
  onDeleteSession,
}) => {
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  const visibleSessions = React.useMemo(() => {
    const query = sessionSearchQuery.trim().toLowerCase();
    if (!query) return sessions;

    return sessions.filter((session) => {
      const titleMatches = session.title.toLowerCase().includes(query);
      const workspacePath = session.workspacePath ?? "";
      const workspaceLabel = getWorkspaceLabel(workspacePath).toLowerCase();
      const workspaceMatches =
        workspacePath.toLowerCase().includes(query) ||
        workspaceLabel.includes(query);

      return titleMatches || workspaceMatches;
    });
  }, [sessions, sessionSearchQuery]);

  const groupedSessions = React.useMemo(() => groupSessionsByWorkspace(visibleSessions), [visibleSessions]);
  const workspaceGroups = groupedSessions.filter((group) => group.workspacePath !== "__unknown__");
  const orphanSessions =
    groupedSessions.find((group) => group.workspacePath === "__unknown__")?.sessions ?? [];
  const hasSessionList = visibleSessions.length > 0;

  React.useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, []);

  const handleContextMenu = (event: React.MouseEvent, sessionId: string) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, sessionId });
  };

  return (
    <aside className="left-panel cursor-sidebar">
      <div className="cursor-sidebar-top">
        <button type="button" className="cursor-sidebar-action-row" onClick={onNewSession}>
          <PlusIcon size={14} className="cursor-workspace-icon" />
          <span>新建会话</span>
        </button>
        <button
          type="button"
          className={`cursor-sidebar-action-row ${isSearchOpen ? "active" : ""}`}
          onClick={() => setIsSearchOpen((value) => !value)}
        >
          <SearchIcon size={14} className="cursor-workspace-icon" />
          <span>搜索会话</span>
        </button>
        {isSearchOpen ? (
          <input
            ref={searchInputRef}
            className="cursor-sidebar-search-input"
            value={sessionSearchQuery}
            placeholder="输入关键词"
            onChange={(event) => setSessionSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSessionSearchQuery("");
                setIsSearchOpen(false);
              }
            }}
          />
        ) : null}
      </div>

      <div className="cursor-sidebar-list">
        <div className="cursor-sidebar-section-label">项目</div>
        {hasSessionList ? (
          <>
            {orphanSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                onSelect={() => onSelectSession(session.id)}
                onContextMenu={(event) => handleContextMenu(event, session.id)}
              />
            ))}
            {workspaceGroups.map((group) => (
              <WorkspaceSection
                key={group.workspacePath}
                workspaceKey={group.workspacePath}
                workspaceSessions={group.sessions}
                activeSessionId={activeSessionId}
                onNewSessionInWorkspace={onNewSessionInWorkspace}
                onSelectSession={onSelectSession}
                onContextMenu={handleContextMenu}
              />
            ))}
          </>
        ) : (
          <div className="cursor-sidebar-empty">
            {sessionSearchQuery.trim() ? "没有找到匹配会话" : "暂无会话"}
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
          title="设置"
          style={{ background: "transparent", border: "none" }}
        >
          <SettingsIcon size={18} className="text-secondary hover:text-primary transition-colors" />
        </button>
      </div>

      {contextMenu ? (
        <div
          className="custom-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            className="custom-context-menu-item danger"
            onClick={(event) => {
              event.stopPropagation();
              setContextMenu(null);
              onDeleteSession(contextMenu.sessionId);
            }}
          >
            <TrashIcon size={14} />
            <span>删除会话</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
};
