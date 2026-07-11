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
import { DEFAULT_AGENT_GATEWAY_CONFIG } from "@shared/agent-gateway-config";
import { DESIGN_PRESETS, type DesignSystemV1 } from "@design-system";

type SettingsCategory = "account" | "models" | "gateway" | "generation" | "project" | "appearance";
type UiThemeMode = "light" | "dark" | "cyan" | "orange";
type UiAccentColor = "cyan" | "green" | "purple" | "orange";
type UiControlShape = "sharp" | "soft" | "round";

interface SettingsConsoleProps {
  activeCategory: SettingsCategory;
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveModel: (model: ManagedModel) => void;
  onDeleteModel: (id: string) => void;

  selectedDesignSystem: DesignSystemV1;
  setSelectedDesignSystem: (val: DesignSystemV1) => void;
  logoUrl: string | null;
  onLogoUpload: (url: string) => void;
  onRemoveLogo: () => void;

  autoDownload: boolean;
  setAutoDownload: (val: boolean) => void;
  autoCloudSync: boolean;
  setAutoCloudSync: (val: boolean) => void;
  localStoragePath: string;
  onOpenWorkspace: () => void;
  defaultRatio: "16:9" | "4:3";
  setDefaultRatio: (val: "16:9" | "4:3") => void;
  agentStepLimits: AgentStepLimits;
  setAgentStepLimits: (val: AgentStepLimits) => void;
  agentGatewayPreferences: AgentGatewayPreferences;
  setAgentGatewayPreferences: (val: AgentGatewayPreferences) => void;

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
  account: {
    title: "账户与额度",
  },
  models: {
    title: "AI 模型",
  },
  gateway: {
    title: "生成参数",
  },
  generation: {
    title: "生成偏好",
  },
  project: {
    title: "文件与模板",
  },
  appearance: {
    title: "外观",
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
  { value: "purple", label: "薰衣紫", color: "#a855f7" },
  { value: "orange", label: "珊瑚橙", color: "#f97316" },
];

const controlShapeOptions: Array<{ value: UiControlShape; label: string; radius: string }> = [
  { value: "sharp", label: "利落", radius: "4px" },
  { value: "soft", label: "柔和", radius: "8px" },
  { value: "round", label: "圆润", radius: "14px" },
];

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
  autoDownload,
  setAutoDownload,
  autoCloudSync,
  setAutoCloudSync,
  localStoragePath,
  onOpenWorkspace,
  defaultRatio,
  setDefaultRatio,
  agentStepLimits,
  setAgentStepLimits,
  agentGatewayPreferences,
  setAgentGatewayPreferences,
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
  const totalTokens = 1000000;
  const usedTokens = 354200;
  const remainingTokens = totalTokens - usedTokens;
  const usedPercentage = (usedTokens / totalTokens) * 100;

  const trendData = [
    { label: "周一", val: 12000 },
    { label: "周二", val: 34000 },
    { label: "周三", val: 28000 },
    { label: "周四", val: 95000 },
    { label: "周五", val: 62000 },
    { label: "周六", val: 118000 },
    { label: "周日", val: 89000 },
  ];

  const chartHeight = 80;
  const chartWidth = 320;
  const maxVal = Math.max(...trendData.map((d) => d.val)) * 1.1;
  const points = trendData.map((d, i) => {
    const x = (i / (trendData.length - 1)) * chartWidth;
    const y = chartHeight - (d.val / maxVal) * chartHeight;
    return { x, y, ...d };
  });

  const pathD = `M ${points.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
  const areaD = `${pathD} L ${points[points.length - 1].x} ${chartHeight} L ${points[0].x} ${chartHeight} Z`;
  const enabledModelCount = models.filter(isModelEnabled).length;
  const currentMeta = categoryMeta[activeCategory];
  const selectedAccentLabel = accentOptions.find((option) => option.value === uiAccentColor)?.label ?? "湖蓝";
  const selectedShapeLabel = controlShapeOptions.find((option) => option.value === uiControlShape)?.label ?? "柔和";
  const selectedThemeModeLabel = themeModeOptions.find((option) => option.value === themeMode)?.label ?? "浅色主题";
  const logoFileInputRef = React.useRef<HTMLInputElement>(null);

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
          <div className={`settings-header-pill ${saveStatus === "saving" ? "is-saving" : ""}`}>
            {saveStatus === "saving" ? <RefreshIcon size={15} /> : <CheckCircleIcon size={15} />}
            <span>{saveStatus === "saving" ? "正在保存" : "本地已保存"}</span>
          </div>
        </header>

        {activeCategory === "account" && (
          <div className="settings-panel-fade">
            <section className="settings-card settings-profile-card">
              <div className="settings-avatar-large">P</div>
              <div className="settings-profile-copy">
                <span className="settings-page-kicker">当前账户</span>
                <h3>PPT 创作者</h3>
                <p>Premium Enterprise · 创意设计部</p>
              </div>
              <div className="settings-profile-status">
                <span>可用额度</span>
                <strong>{Math.round(remainingTokens / 1000)}k</strong>
              </div>
            </section>

            <section className="settings-card">
              <SettingsCardHeader
                icon={<BrainIcon size={16} />}
                title="Token 用量"
                meta={<span>{usedPercentage.toFixed(1)}%</span>}
              />
              <div className="settings-progress-track" aria-label="Token 已用比例">
                <span className="settings-progress-bar" style={{ width: `${usedPercentage}%` }} />
              </div>
              <div className="settings-stat-grid">
                <div>
                  <span>已使用</span>
                  <strong>{usedTokens.toLocaleString()} Tokens</strong>
                </div>
                <div>
                  <span>剩余</span>
                  <strong>{remainingTokens.toLocaleString()} Tokens</strong>
                </div>
                <div>
                  <span>总额度</span>
                  <strong>{totalTokens.toLocaleString()} Tokens</strong>
                </div>
              </div>
            </section>

            <section className="settings-card">
              <SettingsCardHeader
                icon={<PaletteIcon size={16} />}
                title="近期消耗"
              />
              <div className="settings-trend-chart">
                <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} aria-hidden="true">
                  <defs>
                    <linearGradient id="settingsChartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line x1="0" y1={chartHeight / 2} x2={chartWidth} y2={chartHeight / 2} stroke="var(--border-glass)" />
                  <line x1="0" y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="var(--border-glass)" />
                  <path d={areaD} fill="url(#settingsChartGrad)" />
                  <path d={pathD} fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  {points.map((point) => (
                    <circle
                      key={point.label}
                      cx={point.x}
                      cy={point.y}
                      r="3.5"
                      fill="var(--bg-input-field)"
                      stroke="var(--accent-primary)"
                      strokeWidth="2"
                    />
                  ))}
                </svg>
                <div className="settings-chart-labels">
                  {trendData.map((item) => (
                    <span key={item.label}>{item.label}</span>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {activeCategory === "models" && (
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

        {activeCategory === "gateway" && (
          <div className="settings-panel-fade">
            <section className="settings-card">
              <SettingsCardHeader
                icon={<SettingsIcon size={16} />}
                title="生成参数"
                meta={<span>{enabledModelCount} 个可用</span>}
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
                    min={1024}
                    max={131072}
                    step={1024}
                    value={agentGatewayPreferences.maxOutputTokens}
                    onChange={(event) => setAgentGatewayPreferences({
                      ...agentGatewayPreferences,
                      maxOutputTokens: parseInt(event.target.value, 10) || DEFAULT_AGENT_GATEWAY_CONFIG.maxOutputTokens,
                    })}
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

                <label className="config-group">
                  <span className="config-label">Tavily 搜索 API Key</span>
                  <input
                    className="config-input"
                    type="password"
                    value={agentGatewayPreferences.webSearchApiKey ?? ""}
                    placeholder="tvly-...（也可设置 TAVILY_API_KEY）"
                    onChange={(event) => setAgentGatewayPreferences({
                      ...agentGatewayPreferences,
                      webSearchApiKey: event.target.value.trim() || undefined,
                    })}
                  />
                </label>

                <label className="config-group">
                  <span className="config-label">搜索 API 端点（可选）</span>
                  <input
                    className="config-input"
                    value={agentGatewayPreferences.webSearchEndpoint ?? ""}
                    placeholder="https://api.tavily.com/search"
                    onChange={(event) => setAgentGatewayPreferences({
                      ...agentGatewayPreferences,
                      webSearchEndpoint: event.target.value.trim() || undefined,
                    })}
                  />
                </label>
              </div>
            </section>
          </div>
        )}

        {activeCategory === "generation" && (
          <div className="settings-panel-fade">
            <section className="settings-card">
              <SettingsCardHeader
                icon={<BrainIcon size={16} />}
                title="Agent 调用限制"
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

            <section className="settings-card">
              <SettingsCardHeader
                icon={<FolderIcon size={16} />}
                title="生成后动作"
              />

              <SettingRow title="生成完成后自动下载">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoDownload}
                    onChange={(event) => setAutoDownload(event.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </SettingRow>

              <SettingRow title="云端空间备份" muted>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoCloudSync}
                    disabled
                    onChange={(event) => setAutoCloudSync(event.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </SettingRow>
            </section>
          </div>
        )}

        {activeCategory === "project" && (
          <div className="settings-panel-fade">
            <section className="settings-card">
              <SettingsCardHeader
                icon={<FolderIcon size={16} />}
                title="项目工作目录"
              />

              <div className="settings-path-display">
                <FolderIcon size={15} />
                <span title={localStoragePath}>{localStoragePath || "尚未打开项目目录"}</span>
                <button className="settings-secondary-btn" onClick={() => void handleOpenWorkspace()}>
                  打开目录
                </button>
              </div>
            </section>

            <section className="settings-card">
              <SettingsCardHeader
                icon={<PaletteIcon size={16} />}
                title="演示文稿默认模板"
              />

              <div className="settings-choice-grid">
                <button
                  className={`settings-choice-card ${defaultRatio === "16:9" ? "active" : ""}`}
                  onClick={() => setDefaultRatio("16:9")}
                >
                  <span className="settings-ratio-preview settings-ratio-preview--wide" />
                  <span>16:9 宽屏</span>
                </button>
                <button
                  className={`settings-choice-card ${defaultRatio === "4:3" ? "active" : ""}`}
                  onClick={() => setDefaultRatio("4:3")}
                >
                  <span className="settings-ratio-preview settings-ratio-preview--classic" />
                  <span>4:3 经典屏</span>
                </button>
              </div>

              <div className="settings-inline-grid">
                <label className="config-group">
                  <span className="config-label">默认设计系统</span>
                  <select
                    value={DESIGN_PRESETS.find((preset) => preset.system.tokens.palette === selectedDesignSystem.tokens.palette)?.id ?? DESIGN_PRESETS[0].id}
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
                  <span>{selectedDesignSystem.tokens.palette} · {selectedDesignSystem.tokens.fontMood} · {selectedDesignSystem.tokens.backgroundStyle}</span>
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
                      accept="image/*"
                    />
                    <UploadIcon size={18} className="upload-icon" />
                    <span>选择品牌 Logo</span>
                  </button>
                )}
              </div>
            </section>
          </div>
        )}

        {activeCategory === "appearance" && (
          <div className="settings-panel-fade">
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
