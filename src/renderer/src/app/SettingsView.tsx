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
      <div className="rounded-canvas">
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
          autoDownload={controller.autoDownload}
          setAutoDownload={controller.setAutoDownload}
          autoCloudSync={controller.autoCloudSync}
          setAutoCloudSync={controller.setAutoCloudSync}
          localStoragePath={localStoragePath}
          onOpenWorkspace={onOpenWorkspace}
          defaultRatio={controller.defaultRatio}
          setDefaultRatio={controller.setDefaultRatio}
          agentStepLimits={controller.agentStepLimits}
          setAgentStepLimits={controller.setAgentStepLimits}
          agentGatewayPreferences={controller.agentGatewayPreferences}
          setAgentGatewayPreferences={controller.setAgentGatewayPreferences}
          themeMode={controller.themeMode}
          setThemeMode={controller.setThemeMode}
          uiAccentColor={controller.uiAccentColor}
          setUiAccentColor={controller.setUiAccentColor}
          uiControlShape={controller.uiControlShape}
          setUiControlShape={controller.setUiControlShape}
          borderRadiusScale={controller.borderRadiusScale}
          setBorderRadiusScale={controller.setBorderRadiusScale}
          colorContrastOffset={controller.colorContrastOffset}
          setColorContrastOffset={controller.setColorContrastOffset}
          triggerToast={notify}
          saveStatus={controller.saveStatus}
        />
      </div>
    </>
  );
}
import type { ComponentProps } from "react";
