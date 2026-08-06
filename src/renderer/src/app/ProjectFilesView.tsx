import type { ComponentProps } from "react";
import { LeftPanel } from "../components/LeftPanel";
import { ProjectFilesPage } from "../components/ProjectFilesPage";
import type { ResizablePanel } from "./useWorkbenchLayout";

interface ProjectFilesViewProps {
  leftPanelProps: Omit<ComponentProps<typeof LeftPanel>, "collapsed" | "onToggleCollapsed">;
  projectFilesProps: ComponentProps<typeof ProjectFilesPage>;
  isPrimarySidebarCollapsed: boolean;
  onTogglePrimarySidebar: () => void;
  onStartPanelResize: (panel: ResizablePanel, startClientX: number) => void;
}

export function ProjectFilesView({
  leftPanelProps,
  projectFilesProps,
  isPrimarySidebarCollapsed,
  onTogglePrimarySidebar,
  onStartPanelResize,
}: ProjectFilesViewProps) {
  return (
    <>
      <div className="primary-sidebar-slot">
        <LeftPanel
          {...leftPanelProps}
          collapsed={isPrimarySidebarCollapsed}
          onToggleCollapsed={onTogglePrimarySidebar}
        />
      </div>

      {!isPrimarySidebarCollapsed ? (
        <div
          className="panel-resizer panel-resizer--primary"
          role="separator"
          aria-label="调整工作台侧栏宽度"
          aria-orientation="vertical"
          onPointerDown={(event) => {
            event.preventDefault();
            onStartPanelResize("primary", event.clientX);
          }}
        />
      ) : (
        <div className="panel-resizer-placeholder" />
      )}

      <div
        key="files"
        className="rounded-canvas workbench-main-surface view-enter"
        data-ui-region="canvas"
      >
        <ProjectFilesPage {...projectFilesProps} />
      </div>
    </>
  );
}
