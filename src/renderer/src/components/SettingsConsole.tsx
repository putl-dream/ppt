import type { AgentExecutionStrategy } from "@shared/agent";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { CredentialStorageStatus } from "@shared/credentials";
import type { DesignSystemV2 } from "@design-system";
import type { UiThemeSummary } from "@shared/ipc";
import type { UiFontFamily } from "../app/uiTypography";
import type { ManagedModel } from "../modelCatalog";
import type { SettingsCategory } from "../settingsCategories";
import { cx } from "../lib/cx";
import { TokenUsageOverview } from "./TokenUsageOverview";
import {
  AgentApprovalSettingsPanel,
  AgentLimitsSettingsPanel,
  AgentLogsSettingsPanel,
} from "./settings/AgentSettingsPanels";
import {
  AppearanceSettingsPanel,
  type UiColorScheme,
} from "./settings/AppearanceSettingsPanel";
import {
  ModelListSettingsPanel,
  ModelRuntimeSettingsPanel,
  useWebSearchSettings,
  WebSearchSettingsPanel,
  type WebSearchSettingsController,
} from "./settings/ModelSettingsPanels";
import { PresentationSettingsPanel } from "./settings/PresentationSettingsPanel";
import { SettingsPanel } from "./settings/SettingsPrimitives";
import { StorageSettingsPanel } from "./settings/StorageSettingsPanel";

interface SettingsConsoleProps {
  activeCategory: SettingsCategory;
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveModel: (model: ManagedModel, apiKey?: string) => Promise<boolean>;
  onSaveModels: (models: ManagedModel[], apiKey: string) => Promise<boolean>;
  onDeleteModel: (id: string) => Promise<boolean>;
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
  "models-list": "模型",
  "models-search": "搜索与联网",
  "models-runtime": "运行参数",
  "preferences-presentation": "演示与品牌",
  "preferences-storage": "存储",
  "preferences-appearance": "界面外观",
  "agent-approval": "提交与审批",
  "agent-limits": "限流",
  "agent-logs": "系统日志",
  "usage-overview": "用量与费用",
};

function renderCategory(
  props: SettingsConsoleProps,
  webSearchController: WebSearchSettingsController,
) {
  switch (props.activeCategory) {
    case "usage-overview":
      return (
        <SettingsPanel>
          <TokenUsageOverview models={props.models} selectedModelId={props.selectedModelId} />
        </SettingsPanel>
      );
    case "models-list":
      return (
        <ModelListSettingsPanel
          models={props.models}
          selectedModelId={props.selectedModelId}
          onSelectModel={props.onSelectModel}
          onSaveModel={props.onSaveModel}
          onSaveModels={props.onSaveModels}
          onDeleteModel={props.onDeleteModel}
          credentialStorageStatus={props.credentialStorageStatus}
          notify={props.triggerToast}
        />
      );
    case "models-search":
      return (
        <WebSearchSettingsPanel
          credentialStorageStatus={props.credentialStorageStatus}
          credentialConfigured={props.webSearchCredentialConfigured}
          preferences={props.agentGatewayPreferences}
          setPreferences={props.setAgentGatewayPreferences}
          controller={webSearchController}
        />
      );
    case "models-runtime":
      return (
        <ModelRuntimeSettingsPanel
          models={props.models}
          selectedModelId={props.selectedModelId}
          credentialStorageStatus={props.credentialStorageStatus}
          preferences={props.agentGatewayPreferences}
          setPreferences={props.setAgentGatewayPreferences}
        />
      );
    case "agent-approval":
      return (
        <AgentApprovalSettingsPanel
          executionStrategy={props.executionStrategy}
          setExecutionStrategy={props.setExecutionStrategy}
        />
      );
    case "agent-limits":
      return (
        <AgentLimitsSettingsPanel
          limits={props.agentStepLimits}
          setLimits={props.setAgentStepLimits}
        />
      );
    case "agent-logs":
      return <AgentLogsSettingsPanel notify={props.triggerToast} />;
    case "preferences-storage":
      return (
        <StorageSettingsPanel
          localStoragePath={props.localStoragePath}
          onOpenWorkspace={props.onOpenWorkspace}
          notify={props.triggerToast}
        />
      );
    case "preferences-presentation":
      return (
        <PresentationSettingsPanel
          selectedDesignSystem={props.selectedDesignSystem}
          defaultTemplateId={props.defaultTemplateId}
          setDefaultTemplateId={props.setDefaultTemplateId}
          activeSessionId={props.activeSessionId}
          notify={props.triggerToast}
        />
      );
    case "preferences-appearance":
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
  const webSearchController = useWebSearchSettings({
    preferences: props.agentGatewayPreferences,
    setPreferences: props.setAgentGatewayPreferences,
    onSaveCredential: props.onSaveWebSearchCredential,
    onDeleteCredential: props.onDeleteWebSearchCredential,
    notify: props.triggerToast,
  });
  const saveStatus = props.saveStatus ?? "saved";

  return (
    <div className="ide-page settings-console-container" data-ui-region="settings">
      <div className="ide-page-inner">
        <header className="ide-page-header">
          <h1 className="ide-page-title">{categoryTitles[props.activeCategory]}</h1>
          {props.activeCategory !== "usage-overview" ? (
            <span className={cx("ide-status", saveStatus === "saving" && "is-saving")}>
              {saveStatus === "saving" ? "保存中…" : "已保存"}
            </span>
          ) : null}
        </header>
        <div key={props.activeCategory} className="view-enter">
          {renderCategory(props, webSearchController)}
        </div>
      </div>
    </div>
  );
}
