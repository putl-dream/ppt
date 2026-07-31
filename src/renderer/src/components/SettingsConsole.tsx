import React from "react";
import {
  BrainIcon,
  CheckCircleIcon,
  FolderIcon,
  MoonIcon,
  PaletteIcon,
  RefreshIcon,
  SettingsIcon,
  SunIcon,
  UploadIcon,
} from "./Icons";
import { isModelEnabled, type ManagedModel } from "../modelCatalog";
import { ModelManagement } from "./ModelManagement";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentExecutionStrategy } from "@shared/agent";
import { TokenUsageOverview } from "./TokenUsageOverview";
import { LogManagementPanel } from "./LogManagementPanel";
import { DESIGN_PRESETS, type DesignSystemV2 } from "@design-system";
import {
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  normalizeOutputTokenDraft,
} from "@shared/generation-settings-inputs";
import type { SettingsCategory } from "../settingsCategories";

type UiThemeMode = "light" | "dark" | "cyan" | "orange";
type UiAccentColor = "cyan" | "green" | "orange";
type UiControlShape = "sharp" | "soft" | "round";

interface SettingsConsoleProps {
  activeCategory: SettingsCategory;
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveModel: (model: ManagedModel) => void;
  onDeleteModel: (id: string) => void;

  selectedDesignSystem: DesignSystemV2;
  setSelectedDesignSystem: (val: DesignSystemV2) => void;
  logoUrl: string | null;
  onLogoUpload: (url: string) => void;
  onRemoveLogo: () => void;

  localStoragePath: string;
  onOpenWorkspace: () => void;
  agentStepLimits: AgentStepLimits;
  setAgentStepLimits: (val: AgentStepLimits) => void;
  agentGatewayPreferences: AgentGatewayPreferences;
  setAgentGatewayPreferences: (val: AgentGatewayPreferences) => void;
  executionStrategy: AgentExecutionStrategy;
  setExecutionStrategy: (val: AgentExecutionStrategy) => void;

  themeMode: UiThemeMode;
  setThemeMode: (val: UiThemeMode) => void;
  uiAccentColor: UiAccentColor;
  setUiAccentColor: (val: UiAccentColor) => void;
  uiControlShape: UiControlShape;
  setUiControlShape: (val: UiControlShape) => void;
  borderRadiusScale: number;
  setBorderRadiusScale: (val: number) => void;
  colorContrastOffset: number;
  setColorContrastOffset: (val: number) => void;

  triggerToast: (msg: string) => void;
  saveStatus?: "saved" | "saving";
}

const categoryMeta: Record<SettingsCategory, { title: string }> = {
  "models-list": {
    title: "模型列表",
  },
  "models-search": {
    title: "搜索与联网",
  },
  "models-runtime": {
    title: "运行参数",
  },
  "preferences-presentation": {
    title: "演示文档默认项",
  },
  "preferences-storage": {
    title: "存储与目录",
  },
  "preferences-appearance": {
    title: "界面外观（UI）",
  },
  "agent-approval": {
    title: "提交与审批",
  },
  "agent-limits": {
    title: "调用频率限制",
  },
  "agent-logs": {
    title: "系统日志",
  },
  "usage-overview": {
    title: "用量统计与趋势",
  },
};

function SettingsCardHeader({
  icon,
  title,
  meta,
}: {
  icon?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="settings-card-header">
      {icon && <div className="settings-card-icon">{icon}</div>}
      <div className="settings-card-title-block">
        <h3>{title}</h3>
      </div>
      {meta && <div className="settings-card-meta">{meta}</div>}
    </div>
  );
}

function SettingRow({
  title,
  muted = false,
  children,
}: {
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`setting-row ${muted ? "is-muted" : ""}`}>
      <div className="setting-row-copy">
        <div className="setting-row-title">{title}</div>
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

function ThemePreview({ mode }: { mode: UiThemeMode }) {
  return (
    <div className={`settings-theme-preview settings-theme-preview--${mode}`}>
      <span className="settings-theme-sidebar" />
      <span className="settings-theme-content">
        <span />
        <span />
      </span>
    </div>
  );
}

const accentOptions: Array<{ value: UiAccentColor; label: string; color: string }> = [
  { value: "cyan", label: "湖蓝", color: "#0ea5e9" },
  { value: "green", label: "科技绿", color: "#10b981" },
  { value: "orange", label: "珊瑚橙", color: "#f97316" },
];

const controlShapeOptions: Array<{ value: UiControlShape; label: string; radius: string }> = [
  { value: "sharp", label: "利落", radius: "4px" },
  { value: "soft", label: "柔和", radius: "8px" },
  { value: "round", label: "圆润", radius: "14px" },
];

const SUPPORTED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
const MAX_LOGO_BYTES = 12 * 1024 * 1024;

const themeModeOptions: Array<{
  value: UiThemeMode;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "cyan", label: "青色主题", icon: <PaletteIcon size={14} /> },
  { value: "orange", label: "橙色主题", icon: <PaletteIcon size={14} /> },
  { value: "light", label: "浅色主题", icon: <SunIcon size={14} /> },
  { value: "dark", label: "暗色主题", icon: <MoonIcon size={14} /> },
];

export const SettingsConsole: React.FC<SettingsConsoleProps> = ({
  activeCategory,
  models,
  selectedModelId,
  onSelectModel,
  onSaveModel,
  onDeleteModel,
  selectedDesignSystem,
  setSelectedDesignSystem,
  logoUrl,
  onLogoUpload,
  onRemoveLogo,
  localStoragePath,
  onOpenWorkspace,
  agentStepLimits,
  setAgentStepLimits,
  agentGatewayPreferences,
  setAgentGatewayPreferences,
  executionStrategy,
  setExecutionStrategy,
  themeMode,
  setThemeMode,
  uiAccentColor,
  setUiAccentColor,
  uiControlShape,
  setUiControlShape,
  borderRadiusScale,
  setBorderRadiusScale,
  colorContrastOffset,
  setColorContrastOffset,
  triggerToast,
  saveStatus = "saved",
}) => {
  const enabledModelCount = models.filter(isModelEnabled).length;
  const currentMeta = categoryMeta[activeCategory];
  const selectedAccentLabel = accentOptions.find((option) => option.value === uiAccentColor)?.label ?? "湖蓝";
  const selectedShapeLabel = controlShapeOptions.find((option) => option.value === uiControlShape)?.label ?? "柔和";
  const selectedThemeModeLabel = themeModeOptions.find((option) => option.value === themeMode)?.label ?? "浅色主题";
  const selectedColorSchemeName = typeof selectedDesignSystem.colorScheme === "string"
    ? selectedDesignSystem.colorScheme
    : selectedDesignSystem.colorScheme.name ?? "custom";
  const logoFileInputRef = React.useRef<HTMLInputElement>(null);
  const [maxOutputTokensDraft, setMaxOutputTokensDraft] = React.useState(
    () => String(agentGatewayPreferences.maxOutputTokens),
  );

  React.useEffect(() => {
    setMaxOutputTokensDraft(String(agentGatewayPreferences.maxOutputTokens));
  }, [agentGatewayPreferences.maxOutputTokens]);

  const commitMaxOutputTokens = () => {
    const maxOutputTokens = normalizeOutputTokenDraft(
      maxOutputTokensDraft,
      agentGatewayPreferences.maxOutputTokens,
    );
    setMaxOutputTokensDraft(String(maxOutputTokens));
    if (maxOutputTokens !== agentGatewayPreferences.maxOutputTokens) {
      setAgentGatewayPreferences({
        ...agentGatewayPreferences,
        maxOutputTokens,
      });
    }
  };

  const commitOptionalGatewayText = (
    field: "webSearchApiKey" | "webSearchEndpoint",
    value: string,
  ) => {
    const normalized = value.trim() || undefined;
    if (agentGatewayPreferences[field] === normalized) return;
    setAgentGatewayPreferences({
      ...agentGatewayPreferences,
      [field]: normalized,
    });
  };

  const handleOpenWorkspace = async () => {
    try {
      onOpenWorkspace();
    } catch (err) {
      triggerToast(`打开目录失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleLogoUploadReal = () => {
    logoFileInputRef.current?.click();
  };

  const handleLogoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    if (!SUPPORTED_LOGO_TYPES.has(file.type)) {
      triggerToast("Logo 仅支持 PNG、JPEG 或 GIF 文件");
      return;
    }
    if (file.size === 0 || file.size > MAX_LOGO_BYTES) {
      triggerToast("Logo 文件必须大于 0 且不超过 12 MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const result = loadEvent.target?.result as string;
      onLogoUpload(result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="settings-console-container">
      <div className="settings-layout-grid">
        <header className="settings-page-header">
          <div>
            <h1>{currentMeta.title}</h1>
          </div>
          {activeCategory !== "usage-overview" && (
            <div className={`settings-header-pill ${saveStatus === "saving" ? "is-saving" : ""}`}>
              {saveStatus === "saving" ? <RefreshIcon size={15} /> : <CheckCircleIcon size={15} />}
              <span>{saveStatus === "saving" ? "正在保存" : "本地已保存"}</span>
            </div>
          )}
        </header>

        {activeCategory === "usage-overview" && (
          <div className="settings-panel-fade">
            <TokenUsageOverview models={models} selectedModelId={selectedModelId} />
          </div>
        )}

        {activeCategory === "models-list" && (
          <div className="settings-panel-fade">
            <ModelManagement
              models={models}
              selectedModelId={selectedModelId}
              onSelectModel={onSelectModel}
              onSaveModel={onSaveModel}
              onDeleteModel={onDeleteModel}
              triggerToast={triggerToast}
            />
          </div>
        )}

        {activeCategory === "models-search" && (
          <div className="settings-panel-fade">
            <section className="settings-card">
              <SettingsCardHeader
                icon={<BrainIcon size={16} />}
                title="搜索与联网"
                meta={<span>可选</span>}
              />

              <div className="settings-form-stack">
                <label className="config-group">
                  <span className="config-label">Tavily API Key</span>
                  <input
                    className="config-input"
                    type="password"
                    value={agentGatewayPreferences.webSearchApiKey ?? ""}
                    placeholder="tvly-...（也可设置 TAVILY_API_KEY）"
                    onChange={(event) => setAgentGatewayPreferences({
                      ...agentGatewayPreferences,
                      webSearchApiKey: event.target.value || undefined,
                    })}
                    onBlur={(event) => commitOptionalGatewayText("webSearchApiKey", event.target.value)}
                  />
                </label>

                <label className="config-group">
                  <span className="config-label">Search Endpoint</span>
                  <input
                    className="config-input"
                    value={agentGatewayPreferences.webSearchEndpoint ?? ""}
                    placeholder="https://api.tavily.com/search"
                    onChange={(event) => setAgentGatewayPreferences({
                      ...agentGatewayPreferences,
                      webSearchEndpoint: event.target.value || undefined,
                    })}
                    onBlur={(event) => commitOptionalGatewayText("webSearchEndpoint", event.target.value)}
                  />
                </label>
              </div>
            </section>
          </div>
        )}

        {activeCategory === "models-runtime" && (
          <div className="settings-panel-fade">
            <section className="settings-card">
              <SettingsCardHeader
                icon={<SettingsIcon size={16} />}
                title="运行参数"
                meta={<span>{enabledModelCount} 个模型可用</span>}
              />

              <div className="settings-form-stack">
                <label className="config-group">
                  <div className="settings-field-topline">
                    <span className="config-label">最长等待时间</span>
                    <span className="settings-field-value">{Math.round(agentGatewayPreferences.timeoutMs / 1000)} 秒</span>
                  </div>
                  <input
                    className="settings-range"
                    type="range"
                    min={60}
                    max={900}
                    step={30}
                    value={Math.round(agentGatewayPreferences.timeoutMs / 1000)}
                    onChange={(event) => setAgentGatewayPreferences({
                      ...agentGatewayPreferences,
                      timeoutMs: parseInt(event.target.value, 10) * 1000,
                    })}
                  />
                </label>

                <label className="config-group">
                  <span className="config-label">单次输出长度上限</span>
                  <input
                    className="config-input"
                    type="number"
                    min={MIN_OUTPUT_TOKENS}
                    max={MAX_OUTPUT_TOKENS}
                    step={1024}
                    value={maxOutputTokensDraft}
                    onChange={(event) => setMaxOutputTokensDraft(event.target.value)}
                    onBlur={commitMaxOutputTokens}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>

                <label className="config-group">
                  <span className="config-label">服务繁忙时备用模型</span>
                  <select
                    className="model-select"
                    value={agentGatewayPreferences.fallbackModelId ?? ""}
                    onChange={(event) => setAgentGatewayPreferences({
                      ...agentGatewayPreferences,
                      fallbackModelId: event.target.value || undefined,
                    })}
                  >
                    <option value="">不启用</option>
                    {models
                      .filter((model) => model.id !== selectedModelId && isModelEnabled(model))
                      .map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({model.model})
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </section>
          </div>
        )}

        {activeCategory === "agent-approval" && (
          <div className="settings-panel-fade">
            <section className="settings-card">
              <SettingsCardHeader
                icon={<CheckCircleIcon size={16} />}
                title="提交与审批（CommitGate）"
              />

              <label className="config-group">
                <span className="config-label">审批模式</span>
                <select
                  className="model-select"
                  value={executionStrategy}
                  onChange={(event) => setExecutionStrategy(
                    event.target.value as AgentExecutionStrategy,
                  )}
                >
                  <option value="REQUEST_APPROVAL">手动确认每次修改</option>
                  <option value="AUTO">自动应用低风险修改</option>
                </select>
                <span className="settings-help-text">
                  自动模式仅直接应用低风险提案；中高风险修改仍由 CommitGate 请求确认。
                </span>
              </label>
            </section>
          </div>
        )}

        {activeCategory === "agent-limits" && (
          <div className="settings-panel-fade">
            <section className="settings-card">
              <SettingsCardHeader
                icon={<BrainIcon size={16} />}
                title="调用频率限制"
              />

              <SettingRow title="启用调用次数限制">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={agentStepLimits.enabled}
                    onChange={(event) => setAgentStepLimits({ ...agentStepLimits, enabled: event.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </SettingRow>

              <div className={`settings-form-stack ${agentStepLimits.enabled ? "" : "is-disabled"}`}>
                <label className="config-group">
                  <div className="settings-field-topline">
                    <span className="config-label">主 Agent 单次上限</span>
                    <span className="settings-field-value">{agentStepLimits.mainMaxSteps} 次</span>
                  </div>
                  <input
                    className="settings-range"
                    type="range"
                    min="8"
                    max="80"
                    step="1"
                    value={agentStepLimits.mainMaxSteps}
                    disabled={!agentStepLimits.enabled}
                    onChange={(event) => setAgentStepLimits({
                      ...agentStepLimits,
                      mainMaxSteps: parseInt(event.target.value, 10),
                    })}
                  />
                </label>

                <label className="config-group">
                  <div className="settings-field-topline">
                    <span className="config-label">子 Agent 单次上限</span>
                    <span className="settings-field-value">{agentStepLimits.subMaxSteps} 次</span>
                  </div>
                  <input
                    className="settings-range"
                    type="range"
                    min="4"
                    max="40"
                    step="1"
                    value={agentStepLimits.subMaxSteps}
                    disabled={!agentStepLimits.enabled}
                    onChange={(event) => setAgentStepLimits({
                      ...agentStepLimits,
                      subMaxSteps: parseInt(event.target.value, 10),
                    })}
                  />
                </label>
              </div>
            </section>

          </div>
        )}

        {activeCategory === "agent-logs" && (
          <div className="settings-panel-fade">
            <LogManagementPanel notify={triggerToast} />
          </div>
        )}

        {activeCategory === "preferences-storage" && (
          <div className="settings-panel-fade">
            <section className="settings-card settings-preferences-storage">
              <SettingsCardHeader
                icon={<FolderIcon size={16} />}
                title="存储与目录"
              />

              <div className="settings-path-display">
                <FolderIcon size={15} />
                <span title={localStoragePath}>{localStoragePath || "尚未打开项目目录"}</span>
                <button className="settings-secondary-btn" onClick={() => void handleOpenWorkspace()}>
                  打开目录
                </button>
              </div>
            </section>

          </div>
        )}

        {activeCategory === "preferences-presentation" && (
          <div className="settings-panel-fade">
            <section className="settings-card settings-preferences-presentation">
              <SettingsCardHeader
                icon={<PaletteIcon size={16} />}
                title="演示文档默认项"
              />

              <div className="settings-choice-grid">
                <button
                  className="settings-choice-card active"
                  type="button"
                >
                  <span className="settings-ratio-preview settings-ratio-preview--wide" />
                  <span>16:9 宽屏</span>
                </button>
              </div>
              <p className="settings-help-text">当前画布与 PPTX 导出统一采用 16:9 宽屏比例。</p>

              <div className="settings-inline-grid">
                <label className="config-group">
                  <span className="config-label">默认设计系统</span>
                  <select
                    value={selectedDesignSystem.visualStyle}
                    onChange={(event) => {
                      const preset = DESIGN_PRESETS.find((item) => item.id === event.target.value);
                      if (preset) setSelectedDesignSystem(preset.system);
                    }}
                    className="model-select"
                  >
                    {DESIGN_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </label>
                <div className="config-group">
                  <span className="config-label">当前设计语言</span>
                  <span>
                    {selectedDesignSystem.argumentMode} · {selectedDesignSystem.visualStyle} ·{" "}
                    {selectedDesignSystem.readingMode} · {selectedColorSchemeName}
                  </span>
                </div>
              </div>

              <div className="config-group">
                <span className="config-label">品牌水印 Logo</span>
                {logoUrl ? (
                  <div className="settings-logo-preview">
                    <img src={logoUrl} alt="Logo" />
                    <button className="settings-secondary-btn" onClick={onRemoveLogo}>
                      移除 Logo
                    </button>
                  </div>
                ) : (
                  <button className="logo-dropzone settings-logo-dropzone" onClick={handleLogoUploadReal}>
                    <input
                      type="file"
                      ref={logoFileInputRef}
                      onChange={handleLogoFileChange}
                      accept="image/png,image/jpeg,image/gif"
                    />
                    <UploadIcon size={18} className="upload-icon" />
                    <span>选择品牌 Logo</span>
                  </button>
                )}
              </div>
            </section>
          </div>
        )}

        {activeCategory === "preferences-appearance" && (
          <div className="settings-panel-fade">
            <div className="settings-section-heading">
              <h2>界面外观</h2>
              <p>以下设置只改变软件自身的皮肤与控件，不影响导出的演示文档。</p>
            </div>
            <section className="settings-card">
              <SettingsCardHeader
                icon={<SunIcon size={16} />}
                title="主题色"
                meta={<span>{selectedThemeModeLabel}</span>}
              />

              <div className="settings-theme-grid">
                {themeModeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`settings-theme-card ${themeMode === option.value ? "active" : ""}`}
                    onClick={() => setThemeMode(option.value)}
                    aria-pressed={themeMode === option.value}
                  >
                    <ThemePreview mode={option.value} />
                    <span>{option.icon} {option.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-card">
              <SettingsCardHeader
                icon={<PaletteIcon size={16} />}
                title="界面重点色"
              />

              <div className="settings-accent-grid">
                {accentOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`settings-accent-card ${uiAccentColor === option.value ? "active" : ""}`}
                    onClick={() => setUiAccentColor(option.value)}
                    aria-pressed={uiAccentColor === option.value}
                  >
                    <span className="settings-accent-swatch" style={{ background: option.color }} />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-card">
              <SettingsCardHeader
                icon={<SettingsIcon size={16} />}
                title="控件形状"
              />

              <div className="settings-control-shape-grid">
                {controlShapeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`settings-control-shape-card ${uiControlShape === option.value ? "active" : ""}`}
                    onClick={() => setUiControlShape(option.value)}
                    aria-pressed={uiControlShape === option.value}
                  >
                    <span className="settings-shape-preview" style={{ borderRadius: option.radius }}>
                      <span />
                      <span />
                    </span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-card">
              <SettingsCardHeader
                icon={<SettingsIcon size={16} />}
                title="界面参数"
              />

              <div className="settings-form-stack">
                <label className="config-group">
                  <div className="settings-field-topline">
                    <span className="config-label">内容区域圆角</span>
                    <span className="settings-field-value">{Math.round(18 * borderRadiusScale)}px</span>
                  </div>
                  <input
                    className="settings-range"
                    type="range"
                    min="0"
                    max="2.2"
                    step="0.1"
                    value={borderRadiusScale}
                    onChange={(event) => setBorderRadiusScale(parseFloat(event.target.value))}
                  />
                </label>

                <label className="config-group">
                  <div className="settings-field-topline">
                    <span className="config-label">双层背景明暗偏置</span>
                    <span className="settings-field-value">
                      {colorContrastOffset > 0 ? `+${colorContrastOffset}` : colorContrastOffset}%
                    </span>
                  </div>
                  <input
                    className="settings-range"
                    type="range"
                    min="-10"
                    max="15"
                    step="1"
                    value={colorContrastOffset}
                    onChange={(event) => setColorContrastOffset(parseInt(event.target.value, 10))}
                  />
                </label>
              </div>
            </section>

            <section className="settings-card settings-preview-card">
              <SettingsCardHeader
                icon={<PaletteIcon size={16} />}
                title="实时预览"
              />
              <div className="settings-preview-surface">
                <div className="settings-preview-icon">
                  <BrainIcon size={15} />
                </div>
                <div>
                  <strong>Agent Canvas Card</strong>
                  <span>{selectedThemeModeLabel} · {selectedAccentLabel} · {selectedShapeLabel} · 内容圆角 {Math.round(18 * borderRadiusScale)}px</span>
                </div>
                <span className="settings-preview-badge">Active</span>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
