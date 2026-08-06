import type { CSSProperties, ReactNode } from "react";
import { SidebarPanelIcon } from "../components/Icons";
import { TitlebarTemplateMenu } from "../components/TitlebarTemplateMenu";
import { NotificationViewport } from "./useNotificationCenter";

interface AppShellProps {
  notificationMessage: string | null;
  workspaceClassName: string;
  workspaceStyle: CSSProperties;
  showSidebarToggle: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  showTemplateMenu?: boolean;
  activeSessionId?: string;
  defaultTemplateId?: string;
  setDefaultTemplateId?: (templateId: string) => void;
  onOpenTemplateSettings?: () => void;
  notify?: (message: string) => void;
  children: ReactNode;
}

export function AppShell({
  notificationMessage,
  workspaceClassName,
  workspaceStyle,
  showSidebarToggle,
  sidebarCollapsed,
  onToggleSidebar,
  showTemplateMenu = false,
  activeSessionId,
  defaultTemplateId = "",
  setDefaultTemplateId,
  onOpenTemplateSettings,
  notify,
  children,
}: AppShellProps) {
  const templateMenuReady = Boolean(
    showTemplateMenu && setDefaultTemplateId && onOpenTemplateSettings && notify,
  );

  return (
    <main className="app-shell">
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
        {templateMenuReady ? (
          <div className="window-titlebar-leading">
            <TitlebarTemplateMenu
              activeSessionId={activeSessionId}
              defaultTemplateId={defaultTemplateId}
              setDefaultTemplateId={setDefaultTemplateId!}
              onOpenTemplateSettings={onOpenTemplateSettings!}
              notify={notify!}
            />
          </div>
        ) : null}
      </div>
      <NotificationViewport message={notificationMessage} />
      <div className={workspaceClassName} style={workspaceStyle}>
        {children}
      </div>
    </main>
  );
}
