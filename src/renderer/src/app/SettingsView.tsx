import type { ComponentProps } from "react";
import { SettingsConsole } from "../components/SettingsConsole";
import { SettingsSidebar } from "../components/SettingsSidebar";
import type { SettingsController } from "./useSettingsController";
import type { ResizablePanel } from "./useWorkbenchLayout";

interface SettingsViewProps {
  activeCategory: ComponentProps<typeof SettingsSidebar>["activeCategory"];
  onSelectCategory: ComponentProps<typeof SettingsSidebar>["onSelectCategory"];
  onBackToWorkspace: () => void;
  controller: SettingsController;
  localStoragePath: string;
  onOpenWorkspace: () => void;
  notify: (message: string) => void;
  onStartPanelResize: (panel: ResizablePanel, startClientX: number) => void;
}

export function SettingsView({
  activeCategory,
  onSelectCategory,
  onBackToWorkspace,
  controller,
  localStoragePath,
  onOpenWorkspace,
  notify,
  onStartPanelResize,
}: SettingsViewProps) {
  return (
    <>
      <div className="primary-sidebar-slot">
        <SettingsSidebar
          activeCategory={activeCategory}
          onSelectCategory={onSelectCategory}
          onBackToWorkspace={onBackToWorkspace}
        />
      </div>
      <div
        className="panel-resizer panel-resizer--primary"
        role="separator"
        aria-label="调整设置导航宽度"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          event.preventDefault();
          onStartPanelResize("primary", event.clientX);
        }}
      />
      <div key="settings" className="rounded-canvas view-enter" data-ui-region="canvas">
        <SettingsConsole
          activeCategory={activeCategory}
          models={controller.models}
          selectedModelId={controller.selectedModelId}
          onSelectModel={controller.selectModel}
          onSaveModel={controller.saveModel}
          onDeleteModel={controller.deleteModel}
          selectedDesignSystem={controller.selectedDesignSystem}
          setSelectedDesignSystem={controller.setSelectedDesignSystem}
          logoUrl={controller.logoUrl}
          onLogoUpload={controller.uploadLogo}
          onRemoveLogo={controller.removeLogo}
          localStoragePath={localStoragePath}
          onOpenWorkspace={onOpenWorkspace}
          agentStepLimits={controller.agentStepLimits}
          setAgentStepLimits={controller.setAgentStepLimits}
          agentGatewayPreferences={controller.agentGatewayPreferences}
          setAgentGatewayPreferences={controller.setAgentGatewayPreferences}
          executionStrategy={controller.executionStrategy}
          setExecutionStrategy={controller.setExecutionStrategy}
          colorScheme={controller.colorScheme}
          setColorScheme={controller.setColorScheme}
          uiThemeId={controller.uiThemeId}
          setUiThemeId={controller.setUiThemeId}
          uiThemes={controller.uiThemes}
          onRefreshUiThemes={() => {
            void controller.refreshUiThemes();
          }}
          onOpenUiThemesDirectory={() => {
            void controller.openUiThemesDirectory();
          }}
          uiFontFamily={controller.uiFontFamily}
          setUiFontFamily={controller.setUiFontFamily}
          uiFontSize={controller.uiFontSize}
          setUiFontSize={controller.setUiFontSize}
          uiLineHeight={controller.uiLineHeight}
          setUiLineHeight={controller.setUiLineHeight}
          triggerToast={notify}
          saveStatus={controller.saveStatus}
        />
      </div>
    </>
  );
}
