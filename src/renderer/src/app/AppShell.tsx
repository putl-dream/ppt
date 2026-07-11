import type { CSSProperties, ReactNode } from "react";
import { SidebarPanelIcon } from "../components/Icons";
import { NotificationViewport } from "./useNotificationCenter";

interface AppShellProps {
  dark: boolean;
  notificationMessage: string | null;
  workspaceClassName: string;
  workspaceStyle: CSSProperties;
  showSidebarToggle: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  children: ReactNode;
}

export function AppShell({
  dark,
  notificationMessage,
  workspaceClassName,
  workspaceStyle,
  showSidebarToggle,
  sidebarCollapsed,
  onToggleSidebar,
  children,
}: AppShellProps) {
  return (
    <main className={`app-shell${dark ? " dark-theme" : ""}`}>
      <div className="window-titlebar" role="toolbar" aria-label="窗口菜单栏">
        {showSidebarToggle ? (
          <button
            type="button"
            className={`window-titlebar-sidebar-toggle${sidebarCollapsed ? " is-collapsed" : ""}`}
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? "展开工作台" : "折叠工作台"}
            aria-label={sidebarCollapsed ? "展开工作台" : "折叠工作台"}
            aria-expanded={!sidebarCollapsed}
          >
            <SidebarPanelIcon size={17} />
          </button>
        ) : null}
      </div>
      <NotificationViewport message={notificationMessage} />
      <div className={workspaceClassName} style={workspaceStyle}>
        {children}
      </div>
    </main>
  );
}
