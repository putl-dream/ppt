import type { DesignSystemV2 } from "@design-system";
import type { AgentExecutionStrategy } from "@shared/agent";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { CredentialStorageStatus } from "@shared/credentials";
import type { UiThemeSummary } from "@shared/ipc";
import type { UiFontFamily } from "../app/uiTypography";
import { cx } from "../lib/cx";
import type { ManagedModel, ModelVendorConnection } from "../modelCatalog";
import { normalizeSettingsCategory, type SettingsCategory } from "../settingsCategories";
import { AgentBehaviorSettingsPanel } from "./settings/AgentSettingsPanels";
import { AppearanceSettingsPanel, type UiColorScheme } from "./settings/AppearanceSettingsPanel";
import { DataSettingsPanel } from "./settings/DataSettingsPanel";
import {
  ModelListSettingsPanel,
  ModelRuntimeSettingsPanel,
  useWebSearchSettings,
  type WebSearchSettingsController,
  WebSearchSettingsPanel,
} from "./settings/ModelSettingsPanels";
import { PresentationSettingsPanel } from "./settings/PresentationSettingsPanel";
import { SettingsPanel } from "./settings/SettingsPrimitives";
import { TokenUsageOverview } from "./TokenUsageOverview";

interface SettingsConsoleProps {
  activeCategory: SettingsCategory;
  vendors: ModelVendorConnection[];
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveVendor: (vendor: ModelVendorConnection, apiKey?: string) => Promise<boolean>;
  onDeleteVendor: (vendorId: string) => Promise<boolean>;
  onDeleteModel: (id: string) => Promise<boolean>;
  onSetVendorEnabled: (vendorId: string, enabled: boolean) => Promise<boolean>;
  onSetModelEnabled: (modelId: string, enabled: boolean) => Promise<boolean>;
  credentialStorageStatus: CredentialStorageStatus | null;
  webSearchCredentialConfigured: boolean;
  onSaveWebSearchCredential: (apiKey: string, endpoint?: string) => Promise<boolean>;
  onDeleteWebSearchCredential: () => Promise<boolean>;

  selectedDesignSystem: DesignSystemV2;
  setSelectedDesignSystem: (value: DesignSystemV2) => void;
  defaultTemplateId: string;
  setDefaultTemplateId: (value: string) => void;
  activeSessionId?: string;

  localStoragePath: string;
  onOpenWorkspace: () => void;
  agentStepLimits: AgentStepLimits;
  setAgentStepLimits: (value: AgentStepLimits) => void;
  agentGatewayPreferences: AgentGatewayPreferences;
  setAgentGatewayPreferences: (value: AgentGatewayPreferences) => void;
  executionStrategy: AgentExecutionStrategy;
  setExecutionStrategy: (value: AgentExecutionStrategy) => void;

  colorScheme: UiColorScheme;
  setColorScheme: (value: UiColorScheme) => void;
  uiThemeId: string;
  setUiThemeId: (value: string) => void;
  uiThemes: UiThemeSummary[];
  onRefreshUiThemes: () => void;
  onOpenUiThemesDirectory: () => void;
  uiFontFamily: UiFontFamily;
  setUiFontFamily: (value: UiFontFamily) => void;
  uiFontSize: number;
  setUiFontSize: (value: number) => void;
  uiLineHeight: number;
  setUiLineHeight: (value: number) => void;

  triggerToast: (message: string) => void;
  saveStatus?: "saved" | "saving";
}

const categoryTitles: Record<SettingsCategory, string> = {
  appearance: "外观",
  models: "模型",
  "web-search": "联网搜索",
  templates: "模板",
  agent: "Agent 行为",
  data: "数据与日志",
  usage: "用量",
};

function renderCategory(
  props: SettingsConsoleProps,
  webSearchController: WebSearchSettingsController,
) {
  switch (props.activeCategory) {
    case "usage":
      return (
        <SettingsPanel>
          <TokenUsageOverview models={props.models} selectedModelId={props.selectedModelId} />
        </SettingsPanel>
      );
    case "models":
      return (
        <div className="settings-panel-stack">
          <ModelListSettingsPanel
            vendors={props.vendors}
            models={props.models}
            selectedModelId={props.selectedModelId}
            onSelectModel={props.onSelectModel}
            onSaveVendor={props.onSaveVendor}
            onDeleteVendor={props.onDeleteVendor}
            onDeleteModel={props.onDeleteModel}
            onSetVendorEnabled={props.onSetVendorEnabled}
            onSetModelEnabled={props.onSetModelEnabled}
            credentialStorageStatus={props.credentialStorageStatus}
            notify={props.triggerToast}
          />
          <ModelRuntimeSettingsPanel
            models={props.models}
            selectedModelId={props.selectedModelId}
            credentialStorageStatus={props.credentialStorageStatus}
            preferences={props.agentGatewayPreferences}
            setPreferences={props.setAgentGatewayPreferences}
          />
        </div>
      );
    case "web-search":
      return (
        <WebSearchSettingsPanel
          credentialStorageStatus={props.credentialStorageStatus}
          credentialConfigured={props.webSearchCredentialConfigured}
          preferences={props.agentGatewayPreferences}
          setPreferences={props.setAgentGatewayPreferences}
          controller={webSearchController}
        />
      );
    case "agent":
      return (
        <AgentBehaviorSettingsPanel
          executionStrategy={props.executionStrategy}
          setExecutionStrategy={props.setExecutionStrategy}
          limits={props.agentStepLimits}
          setLimits={props.setAgentStepLimits}
        />
      );
    case "data":
      return (
        <DataSettingsPanel
          localStoragePath={props.localStoragePath}
          onOpenWorkspace={props.onOpenWorkspace}
          notify={props.triggerToast}
        />
      );
    case "templates":
      return (
        <PresentationSettingsPanel
          selectedDesignSystem={props.selectedDesignSystem}
          defaultTemplateId={props.defaultTemplateId}
          setDefaultTemplateId={props.setDefaultTemplateId}
          activeSessionId={props.activeSessionId}
          notify={props.triggerToast}
        />
      );
    case "appearance":
      return (
        <AppearanceSettingsPanel
          colorScheme={props.colorScheme}
          setColorScheme={props.setColorScheme}
          uiThemeId={props.uiThemeId}
          setUiThemeId={props.setUiThemeId}
          uiThemes={props.uiThemes}
          onRefreshUiThemes={props.onRefreshUiThemes}
          onOpenUiThemesDirectory={props.onOpenUiThemesDirectory}
          uiFontFamily={props.uiFontFamily}
          setUiFontFamily={props.setUiFontFamily}
          uiFontSize={props.uiFontSize}
          setUiFontSize={props.setUiFontSize}
          uiLineHeight={props.uiLineHeight}
          setUiLineHeight={props.setUiLineHeight}
        />
      );
    default: {
      const exhaustiveCategory: never = props.activeCategory;
      return exhaustiveCategory;
    }
  }
}

export function SettingsConsole(props: SettingsConsoleProps) {
  const activeCategory = normalizeSettingsCategory(props.activeCategory);
  const consoleProps: SettingsConsoleProps = { ...props, activeCategory };
  const webSearchController = useWebSearchSettings({
    preferences: props.agentGatewayPreferences,
    setPreferences: props.setAgentGatewayPreferences,
    onSaveCredential: props.onSaveWebSearchCredential,
    onDeleteCredential: props.onDeleteWebSearchCredential,
    notify: props.triggerToast,
  });
  const saveStatus = props.saveStatus ?? "saved";

  return (
    <div className="settings-page settings-console-container" data-ui-region="settings">
      <div className="settings-page-inner">
        <header className="settings-page-header">
          <h1 className="settings-page-title">{categoryTitles[activeCategory]}</h1>
          {activeCategory !== "usage" ? (
            <span className={cx("settings-status", saveStatus === "saving" && "is-saving")}>
              {saveStatus === "saving" ? "保存中…" : "已保存"}
            </span>
          ) : null}
        </header>
        <div key={activeCategory} className="view-enter">
          {renderCategory(consoleProps, webSearchController)}
        </div>
      </div>
    </div>
  );
}
