import React from "react";
import {
  FolderIcon,
  MoonIcon,
  PaletteIcon,
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
import { cx } from "../lib/cx";

type UiColorScheme = "light" | "dark" | "system";
type UiAccentColor = "cyan" | "green" | "orange";
type UiControlShape = "sharp" | "soft" | "round";
type UiSkin = "studio";

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

  colorScheme: UiColorScheme;
  setColorScheme: (val: UiColorScheme) => void;
  skin: UiSkin;
  setSkin: (val: UiSkin) => void;
  uiAccentColor: UiAccentColor;
  setUiAccentColor: (val: UiAccentColor) => void;
  uiControlShape: UiControlShape;
  setUiControlShape: (val: UiControlShape) => void;
  borderRadiusScale: number;
  setBorderRadiusScale: (val: number) => void;

  triggerToast: (msg: string) => void;
  saveStatus?: "saved" | "saving";
}

const categoryMeta: Record<SettingsCategory, { title: string }> = {
  "models-list": { title: "模型列表" },
  "models-search": { title: "搜索与联网" },
  "models-runtime": { title: "运行参数" },
  "preferences-presentation": { title: "演示文档默认项" },
  "preferences-storage": { title: "存储与目录" },
  "preferences-appearance": { title: "界面外观" },
  "agent-approval": { title: "提交与审批" },
  "agent-limits": { title: "调用频率限制" },
  "agent-logs": { title: "系统日志" },
  "usage-overview": { title: "用量统计与趋势" },
};

function IdeRow({
  label,
  muted = false,
  children,
}: {
  label: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cx("ide-row", muted && "is-muted")}>
      <div className="ide-row-label">{label}</div>
      <div className="ide-row-control">{children}</div>
    </div>
  );
}

function IdeSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="ide-section">
      <div className="ide-section-title">
        <h3>{title}</h3>
        {hint ? <span className="ide-hint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

const accentOptions: Array<{ value: UiAccentColor; label: string; color: string }> = [
  { value: "cyan", label: "湖蓝", color: "#0ea5e9" },
  { value: "green", label: "科技绿", color: "#10b981" },
  { value: "orange", label: "珊瑚橙", color: "#f97316" },
];

const controlShapeOptions: Array<{ value: UiControlShape; label: string }> = [
  { value: "sharp", label: "利落" },
  { value: "soft", label: "柔和" },
  { value: "round", label: "圆润" },
];

const SUPPORTED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
const MAX_LOGO_BYTES = 12 * 1024 * 1024;

const colorSchemeOptions: Array<{
  value: UiColorScheme;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "dark", label: "暗色", icon: <MoonIcon size={13} /> },
  { value: "light", label: "浅色", icon: <SunIcon size={13} /> },
  { value: "system", label: "跟随系统", icon: <PaletteIcon size={13} /> },
];

const skinOptions: Array<{ value: UiSkin; label: string }> = [
  { value: "studio", label: "Studio" },
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
  colorScheme,
  setColorScheme,
  skin,
  setSkin,
  uiAccentColor,
  setUiAccentColor,
  uiControlShape,
  setUiControlShape,
  borderRadiusScale,
  setBorderRadiusScale,
  triggerToast,
  saveStatus = "saved",
}) => {
  const enabledModelCount = models.filter(isModelEnabled).length;
  const currentMeta = categoryMeta[activeCategory];
  const selectedAccentLabel = accentOptions.find((option) => option.value === uiAccentColor)?.label ?? "湖蓝";
  const selectedShapeLabel = controlShapeOptions.find((option) => option.value === uiControlShape)?.label ?? "柔和";
  const selectedSchemeLabel = colorSchemeOptions.find((option) => option.value === colorScheme)?.label ?? "暗色";
  const selectedSkinLabel = skinOptions.find((option) => option.value === skin)?.label ?? "Studio";
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
    <div className="ide-page settings-console-container">
      <div className="ide-page-inner">
        <header className="ide-page-header">
          <h1 className="ide-page-title">{currentMeta.title}</h1>
          {activeCategory !== "usage-overview" ? (
            <span className={cx("ide-status", saveStatus === "saving" && "is-saving")}>
              {saveStatus === "saving" ? "保存中…" : "已保存"}
            </span>
          ) : null}
        </header>

        {activeCategory === "usage-overview" ? (
          <div className="ide-panel">
            <TokenUsageOverview models={models} selectedModelId={selectedModelId} />
          </div>
        ) : null}

        {activeCategory === "models-list" ? (
          <div className="ide-panel">
            <ModelManagement
              models={models}
              selectedModelId={selectedModelId}
              onSelectModel={onSelectModel}
              onSaveModel={onSaveModel}
              onDeleteModel={onDeleteModel}
              triggerToast={triggerToast}
            />
          </div>
        ) : null}

        {activeCategory === "models-search" ? (
          <div className="ide-panel">
            <IdeSection title="搜索与联网" hint="可选">
              <IdeRow label="Tavily API Key">
                <input
                  className="ide-field"
                  type="password"
                  value={agentGatewayPreferences.webSearchApiKey ?? ""}
                  placeholder="tvly-...（也可设置 TAVILY_API_KEY）"
                  onChange={(event) => setAgentGatewayPreferences({
                    ...agentGatewayPreferences,
                    webSearchApiKey: event.target.value || undefined,
                  })}
                  onBlur={(event) => commitOptionalGatewayText("webSearchApiKey", event.target.value)}
                />
              </IdeRow>
              <IdeRow label="Search Endpoint">
                <input
                  className="ide-field"
                  value={agentGatewayPreferences.webSearchEndpoint ?? ""}
                  placeholder="https://api.tavily.com/search"
                  onChange={(event) => setAgentGatewayPreferences({
                    ...agentGatewayPreferences,
                    webSearchEndpoint: event.target.value || undefined,
                  })}
                  onBlur={(event) => commitOptionalGatewayText("webSearchEndpoint", event.target.value)}
                />
              </IdeRow>
            </IdeSection>
          </div>
        ) : null}

        {activeCategory === "models-runtime" ? (
          <div className="ide-panel">
            <IdeSection title="运行参数" hint={`${enabledModelCount} 个模型可用`}>
              <IdeRow label="最长等待时间">
                <span className="ide-field-value">{Math.round(agentGatewayPreferences.timeoutMs / 1000)} 秒</span>
                <input
                  className="ide-range"
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
              </IdeRow>
              <IdeRow label="单次输出长度上限">
                <input
                  className="ide-field"
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
              </IdeRow>
              <IdeRow label="服务繁忙时备用模型">
                <select
                  className="ide-select"
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
              </IdeRow>
            </IdeSection>
          </div>
        ) : null}

        {activeCategory === "agent-approval" ? (
          <div className="ide-panel">
            <IdeSection title="提交与审批（CommitGate）">
              <IdeRow label="审批模式">
                <select
                  className="ide-select"
                  value={executionStrategy}
                  onChange={(event) => setExecutionStrategy(
                    event.target.value as AgentExecutionStrategy,
                  )}
                >
                  <option value="REQUEST_APPROVAL">手动确认每次修改</option>
                  <option value="AUTO">自动应用低风险修改</option>
                </select>
              </IdeRow>
              <p className="ide-hint">
                自动模式仅直接应用低风险提案；中高风险修改仍由 CommitGate 请求确认。
              </p>
            </IdeSection>
          </div>
        ) : null}

        {activeCategory === "agent-limits" ? (
          <div className="ide-panel">
            <IdeSection title="调用频率限制">
              <IdeRow label="启用调用次数限制">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={agentStepLimits.enabled}
                    onChange={(event) => setAgentStepLimits({
                      ...agentStepLimits,
                      enabled: event.target.checked,
                    })}
                  />
                  <span className="toggle-slider" />
                </label>
              </IdeRow>
              <IdeRow label="主 Agent 单次上限" muted={!agentStepLimits.enabled}>
                <span className="ide-field-value">{agentStepLimits.mainMaxSteps} 次</span>
                <input
                  className="ide-range"
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
              </IdeRow>
              <IdeRow label="子 Agent 单次上限" muted={!agentStepLimits.enabled}>
                <span className="ide-field-value">{agentStepLimits.subMaxSteps} 次</span>
                <input
                  className="ide-range"
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
              </IdeRow>
            </IdeSection>
          </div>
        ) : null}

        {activeCategory === "agent-logs" ? (
          <div className="ide-panel">
            <LogManagementPanel notify={triggerToast} />
          </div>
        ) : null}

        {activeCategory === "preferences-storage" ? (
          <div className="ide-panel">
            <IdeSection title="存储与目录">
              <IdeRow label="项目目录">
                <div className="ide-path">
                  <FolderIcon size={14} />
                  <span className="ide-path-text" title={localStoragePath}>
                    {localStoragePath || "尚未打开项目目录"}
                  </span>
                  <button
                    type="button"
                    className="ide-btn-secondary"
                    onClick={() => void handleOpenWorkspace()}
                  >
                    打开目录
                  </button>
                </div>
              </IdeRow>
            </IdeSection>
          </div>
        ) : null}

        {activeCategory === "preferences-presentation" ? (
          <div className="ide-panel">
            <IdeSection title="演示文档默认项">
              <IdeRow label="画布比例">
                <span className="ide-hint">16:9 宽屏（当前唯一导出比例）</span>
              </IdeRow>
              <IdeRow label="默认设计系统">
                <select
                  className="ide-select"
                  value={selectedDesignSystem.visualStyle}
                  onChange={(event) => {
                    const preset = DESIGN_PRESETS.find((item) => item.id === event.target.value);
                    if (preset) setSelectedDesignSystem(preset.system);
                  }}
                >
                  {DESIGN_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </select>
              </IdeRow>
              <IdeRow label="当前设计语言">
                <span className="ide-hint">
                  {selectedDesignSystem.argumentMode} · {selectedDesignSystem.visualStyle} ·{" "}
                  {selectedDesignSystem.readingMode} · {selectedColorSchemeName}
                </span>
              </IdeRow>
              <IdeRow label="品牌水印 Logo">
                {logoUrl ? (
                  <div className="settings-logo-preview">
                    <img src={logoUrl} alt="Logo" />
                    <button type="button" className="ide-btn-secondary" onClick={onRemoveLogo}>
                      移除 Logo
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="logo-dropzone settings-logo-dropzone"
                    onClick={handleLogoUploadReal}
                  >
                    <input
                      type="file"
                      ref={logoFileInputRef}
                      onChange={handleLogoFileChange}
                      accept="image/png,image/jpeg,image/gif"
                    />
                    <UploadIcon size={16} className="upload-icon" />
                    <span>选择品牌 Logo</span>
                  </button>
                )}
              </IdeRow>
            </IdeSection>
          </div>
        ) : null}

        {activeCategory === "preferences-appearance" ? (
          <div className="ide-panel">
            <p className="ide-hint">只改变软件自身皮肤与控件，不影响导出的演示文档。</p>

            <IdeSection title="皮肤" hint={selectedSkinLabel}>
              <IdeRow label="设计语言">
                <div className="ide-choice-group" role="group" aria-label="皮肤">
                  {skinOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cx("ide-choice", skin === option.value && "is-active")}
                      onClick={() => setSkin(option.value)}
                      aria-pressed={skin === option.value}
                    >
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </IdeRow>
            </IdeSection>

            <IdeSection title="明暗" hint={selectedSchemeLabel}>
              <IdeRow label="配色方案">
                <div className="ide-choice-group" role="group" aria-label="配色方案">
                  {colorSchemeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cx("ide-choice", colorScheme === option.value && "is-active")}
                      onClick={() => setColorScheme(option.value)}
                      aria-pressed={colorScheme === option.value}
                    >
                      {option.icon}
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </IdeRow>
            </IdeSection>

            <IdeSection title="界面重点色" hint={selectedAccentLabel}>
              <IdeRow label="强调色">
                <div className="ide-choice-group" role="group" aria-label="强调色">
                  {accentOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cx("ide-choice", uiAccentColor === option.value && "is-active")}
                      onClick={() => setUiAccentColor(option.value)}
                      aria-pressed={uiAccentColor === option.value}
                    >
                      <span className="ide-swatch" style={{ background: option.color }} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </IdeRow>
            </IdeSection>

            <IdeSection title="控件形状" hint={selectedShapeLabel}>
              <IdeRow label="圆角风格">
                <div className="ide-choice-group" role="group" aria-label="控件形状">
                  {controlShapeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cx("ide-choice", uiControlShape === option.value && "is-active")}
                      onClick={() => setUiControlShape(option.value)}
                      aria-pressed={uiControlShape === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </IdeRow>
            </IdeSection>

            <IdeSection title="界面参数">
              <IdeRow label="内容区域圆角">
                <span className="ide-field-value">{Math.round(18 * borderRadiusScale)}px</span>
                <input
                  className="ide-range"
                  type="range"
                  min="0"
                  max="2.2"
                  step="0.1"
                  value={borderRadiusScale}
                  onChange={(event) => setBorderRadiusScale(parseFloat(event.target.value))}
                />
              </IdeRow>
            </IdeSection>

            <p className="ide-hint">
              当前：{selectedSkinLabel} · {selectedSchemeLabel} · {selectedAccentLabel} · {selectedShapeLabel} · 内容圆角 {Math.round(18 * borderRadiusScale)}px
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
