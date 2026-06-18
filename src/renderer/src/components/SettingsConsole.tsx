import React from "react";
import { SparklesIcon } from "./Icons";
import type { ManagedModel } from "../modelCatalog";
import { ModelManagement } from "./ModelManagement";

interface SettingsConsoleProps {
  activeCategory: "profile" | "models" | "workflow" | "appearance";
  models: ManagedModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSaveModel: (model: ManagedModel) => void;
  onDeleteModel: (id: string) => void;
  
  // Styles & Templates
  selectedTheme: string;
  setSelectedTheme: (val: string) => void;
  selectedPalette: string;
  setSelectedPalette: (val: string) => void;
  logoUrl: string | null;
  onLogoUpload: (url: string) => void;
  onRemoveLogo: () => void;

  // Workflow options
  autoDownload: boolean;
  setAutoDownload: (val: boolean) => void;
  autoCloudSync: boolean;
  setAutoCloudSync: (val: boolean) => void;
  localStoragePath: string;
  setLocalStoragePath: (val: string) => void;
  defaultRatio: "16:9" | "4:3";
  setDefaultRatio: (val: "16:9" | "4:3") => void;

  // Aesthetics settings
  themeMode: "light" | "dark" | "system";
  setThemeMode: (val: "light" | "dark" | "system") => void;
  borderRadiusScale: number;
  setBorderRadiusScale: (val: number) => void;
  colorContrastOffset: number;
  setColorContrastOffset: (val: number) => void;

  onBackToWorkspace: () => void;
  triggerToast: (msg: string) => void;
}

export const SettingsConsole: React.FC<SettingsConsoleProps> = ({
  activeCategory,
  models,
  selectedModelId,
  onSelectModel,
  onSaveModel,
  onDeleteModel,
  selectedTheme,
  setSelectedTheme,
  selectedPalette,
  setSelectedPalette,
  logoUrl,
  onLogoUpload,
  onRemoveLogo,
  autoDownload,
  setAutoDownload,
  autoCloudSync,
  setAutoCloudSync,
  localStoragePath,
  setLocalStoragePath,
  defaultRatio,
  setDefaultRatio,
  themeMode,
  setThemeMode,
  borderRadiusScale,
  setBorderRadiusScale,
  colorContrastOffset,
  setColorContrastOffset,
  onBackToWorkspace,
  triggerToast,
}) => {
  // Mock Token data
  const totalTokens = 1000000;
  const usedTokens = 354200;
  const remainingTokens = totalTokens - usedTokens;
  const usedPercentage = (usedTokens / totalTokens) * 100;

  // SVG Chart points for Token walkaway trends
  const trendData = [
    { label: "周一", val: 12000 },
    { label: "周二", val: 34000 },
    { label: "周三", val: 28000 },
    { label: "周四", val: 95000 },
    { label: "周五", val: 62000 },
    { label: "周六", val: 118000 },
    { label: "周日", val: 89000 },
  ];

  // Draw SVG lines for trend
  const chartHeight = 80;
  const chartWidth = 320;
  const maxVal = Math.max(...trendData.map(d => d.val)) * 1.1;
  const points = trendData.map((d, i) => {
    const x = (i / (trendData.length - 1)) * chartWidth;
    const y = chartHeight - (d.val / maxVal) * chartHeight;
    return { x, y, ...d };
  });

  const pathD = `M ${points.map(p => `${p.x} ${p.y}`).join(" L ")}`;
  const areaD = `${pathD} L ${points[points.length - 1].x} ${chartHeight} L ${points[0].x} ${chartHeight} Z`;

  // Custom directory path choice via native dialogue
  const handleBrowsePath = async () => {
    try {
      const pathChoice = await window.desktopApi.selectDirectory(localStoragePath);
      if (pathChoice) {
        setLocalStoragePath(pathChoice);
        triggerToast(`📁 保存路径已更新为: ${pathChoice}`);
      }
    } catch (err) {
      triggerToast(`📁 选择路径失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleResetPath = () => {
    setLocalStoragePath("D:/Coding/ppt/workspace");
    triggerToast("📁 保存路径已重置为默认路径");
  };

  const logoFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleLogoUploadReal = () => {
    logoFileInputRef.current?.click();
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        onLogoUpload(result);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="settings-console-container" style={{ padding: "30px", height: "100%", overflowY: "auto" }}>
      {/* Page Header */}
      <div className="settings-section-header" style={{ marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "22px", fontWeight: "600", fontFamily: "var(--font-display)" }}>
            {activeCategory === "profile" && "👤 账户资产与算力配额"}
            {activeCategory === "models" && "自定义模型与连接配置"}
            {activeCategory === "workflow" && "⚙️ 工作流逻辑与文件存储偏好"}
            {activeCategory === "appearance" && "🎨 界面个性化与物理主题"}
          </h2>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-muted)" }}>
            {activeCategory === "profile" && "监控智能体算力消耗与 Token 额度走势"}
            {activeCategory === "models" && "管理 Agent 可用模型，并连接 OpenAI 或 Anthropic 兼容服务"}
            {activeCategory === "workflow" && "配置生成 PPT 后的自动化行为与默认画布偏好"}
            {activeCategory === "appearance" && "微调应用圆角收缩比例与双层背景对比度"}
          </p>
        </div>
        <button
          onClick={onBackToWorkspace}
          className="secondary-btn"
          style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}
        >
          <span>保存并退出设置</span>
        </button>
      </div>

      <div className="settings-layout-grid" style={{ display: "grid", gap: "24px" }}>
        
        {/* ==================== 1. 个人信息 / 账户与配额 ==================== */}
        {activeCategory === "profile" && (
          <div className="settings-panel-fade" style={{ display: "grid", gap: "20px" }}>
            
            {/* User Profile Card */}
            <div className="settings-card" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <div className="profile-avatar-large" style={{
                width: "60px",
                height: "60px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, var(--accent-cyan) 0%, var(--accent-purple) 100%)",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontSize: "24px",
                fontWeight: "600",
                boxShadow: "0 4px 12px var(--accent-cyan-glow)"
              }}>
                P
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600" }}>PPT 创作者 (AI Specialist)</h3>
                <span className="revision-pill" style={{ marginLeft: 0, marginTop: "4px", display: "inline-block" }}>
                  💎 Premium Enterprise Tier
                </span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "8px" }}>创意设计部</span>
              </div>
            </div>

            {/* Token Metrics Dashboard */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px" }}>
              
              {/* Radial Progress Gauge */}
              <div className="settings-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", fontWeight: "600", color: "var(--text-secondary)", width: "100%", textAlign: "left" }}>
                  Token 统一量化大盘
                </h4>
                <div style={{ position: "relative", width: "130px", height: "130px", display: "grid", placeItems: "center" }}>
                  {/* Circular progress bar SVG */}
                  <svg width="120" height="120" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="50" cy="50" r="40" fill="transparent" stroke="var(--border-glass-focused)" strokeWidth="6" />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="transparent"
                      stroke="var(--accent-cyan)"
                      strokeWidth="8"
                      strokeDasharray={2 * Math.PI * 40}
                      strokeDashoffset={2 * Math.PI * 40 * (1 - usedPercentage / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)" }}>{usedPercentage.toFixed(1)}%</span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>已用额度</span>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginTop: "16px", fontSize: "12px" }}>
                  <div>
                    <div style={{ color: "var(--text-muted)", marginBottom: "2px" }}>已使用</div>
                    <strong style={{ color: "var(--accent-cyan)" }}>{(usedTokens / 1000).toFixed(0)}k Tokens</strong>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "var(--text-muted)", marginBottom: "2px" }}>总额度</div>
                    <strong>{(totalTokens / 1000000).toFixed(1)}M Tokens</strong>
                  </div>
                </div>
              </div>

              {/* Light Trend Line Chart */}
              <div className="settings-card" style={{ display: "flex", flexDirection: "column" }}>
                <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: "600", color: "var(--text-secondary)" }}>
                  近期 PPT 生成算力消耗走势
                </h4>
                <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
                  <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ overflow: "visible" }}>
                    <defs>
                      <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0.00" />
                      </linearGradient>
                    </defs>
                    {/* Grid lines */}
                    <line x1="0" y1={chartHeight / 2} x2={chartWidth} y2={chartHeight / 2} stroke="var(--border-glass)" strokeDasharray="4" />
                    <line x1="0" y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="var(--border-glass)" />

                    {/* Gradient Area */}
                    <path d={areaD} fill="url(#chartGrad)" />
                    {/* Line path */}
                    <path d={pathD} fill="none" stroke="var(--accent-cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    
                    {/* Dots */}
                    {points.map((p, idx) => (
                      <g key={idx} className="group cursor-pointer">
                        <circle cx={p.x} cy={p.y} r="4" fill="var(--bg-input-field)" stroke="var(--accent-cyan)" strokeWidth="2" />
                        <title>{p.label}: {p.val.toLocaleString()} Tokens</title>
                      </g>
                    ))}
                  </svg>
                </div>
                {/* Labels */}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "10px", color: "var(--text-muted)" }}>
                  {trendData.map((d, i) => (
                    <span key={i}>{d.label}</span>
                  ))}
                </div>
              </div>

            </div>

            <div className="settings-card">
              <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: "600" }}>账户操作</h4>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button className="optimize-slide-btn" style={{ margin: 0, padding: "8px 16px", opacity: 0.5, cursor: "not-allowed" }} disabled={true}>
                  充值算力配额 (暂未开放)
                </button>
                <button className="secondary-btn" style={{ margin: 0, padding: "8px 16px", opacity: 0.5, cursor: "not-allowed" }} disabled={true}>
                  升级订阅计划 (暂未开放)
                </button>
                <button className="secondary-btn" style={{ margin: 0, padding: "8px 16px", opacity: 0.5, cursor: "not-allowed" }} disabled={true}>
                  查询消费账单 (暂未开放)
                </button>
              </div>
            </div>

          </div>
        )}

        {activeCategory === "models" && (
          <ModelManagement
            models={models}
            selectedModelId={selectedModelId}
            onSelectModel={onSelectModel}
            onSaveModel={onSaveModel}
            onDeleteModel={onDeleteModel}
            triggerToast={triggerToast}
          />
        )}

        {/* ==================== 2. 常规设置：生成工作流偏好 ==================== */}
        {activeCategory === "workflow" && (
          <div className="settings-panel-fade" style={{ display: "grid", gap: "20px" }}>
            
            {/* Automation Toggles */}
            <div className="settings-card">
              <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", fontWeight: "600" }}>文件落地自动化行为 (Post-Generation Automation)</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                
                {/* Auto download */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--text-primary)" }}>PPT 生成完成后立即自动触发下载</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Agent 在全部指令执行并渲染结束后，自动向本地导出 .pptx 文件。</div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={autoDownload}
                      onChange={(e) => setAutoDownload(e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                {/* Cloud sync */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-glass)", paddingTop: "14px", opacity: 0.6 }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--text-primary)" }}>自动同步备份至云端空间 (云端功能暂不可用)</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>实时将每一次 Rev 快照与大纲文档上传至安全的加密云备份底座。（本功能暂不可用）</div>
                  </div>
                  <label className="toggle-switch" style={{ pointerEvents: "none" }}>
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={true}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

              </div>
            </div>

            {/* Local Storage Directory */}
            <div className="settings-card">
              <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", fontWeight: "600" }}>本地文件默认保存路径 (Local Storage Directory)</h4>
              <p style={{ margin: "0 0 16px 0", fontSize: "11px", color: "var(--text-muted)" }}>修改 PPT 导出以及本地会话快照的存储目录归宿。</p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div className="path-display-box" style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "var(--bg-darker)",
                  border: "1px solid var(--border-glass)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-secondary)"
                }}>
                  <span className="truncate" style={{ marginRight: "12px" }}>{localStoragePath}</span>
                  <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                    <button className="secondary-btn" onClick={handleBrowsePath} style={{ padding: "4px 10px", fontSize: "11px" }}>浏览选择</button>
                    <button className="secondary-btn" onClick={handleResetPath} style={{ padding: "4px 10px", fontSize: "11px" }}>重置默认</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Agent Initialization Default */}
            <div className="settings-card">
              <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", fontWeight: "600" }}>Agent 默认排版底座与行为偏好 (Agent Initialization Default)</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                
                {/* PPT Ratio */}
                <div className="config-group">
                  <label className="config-label">默认画布尺寸比例</label>
                  <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                    <button
                      className={`ratio-card-btn ${defaultRatio === "16:9" ? "active" : ""}`}
                      onClick={() => setDefaultRatio("16:9")}
                      style={{
                        flex: 1,
                        background: "var(--bg-input-field)",
                        border: defaultRatio === "16:9" ? "1px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                        borderRadius: "8px",
                        padding: "16px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "8px",
                        transition: "var(--transition-smooth)"
                      }}
                    >
                      <div style={{ width: "64px", height: "36px", border: "1.5px solid currentColor", borderRadius: "4px", opacity: 0.8, background: "rgba(0,0,0,0.02)" }}></div>
                      <span style={{ fontSize: "12px", fontWeight: "600" }}>16:9 Widescreen 宽屏</span>
                    </button>
                    <button
                      className={`ratio-card-btn ${defaultRatio === "4:3" ? "active" : ""}`}
                      onClick={() => setDefaultRatio("4:3")}
                      style={{
                        flex: 1,
                        background: "var(--bg-input-field)",
                        border: defaultRatio === "4:3" ? "1px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                        borderRadius: "8px",
                        padding: "16px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "8px",
                        transition: "var(--transition-smooth)"
                      }}
                    >
                      <div style={{ width: "48px", height: "36px", border: "1.5px solid currentColor", borderRadius: "4px", opacity: 0.8, background: "rgba(0,0,0,0.02)" }}></div>
                      <span style={{ fontSize: "12px", fontWeight: "600" }}>4:3 Traditional 经典屏</span>
                    </button>
                  </div>
                </div>

                {/* Default Preset Theme */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "8px" }}>
                  <div className="config-group">
                    <label className="config-label">新建会话默认设计底座</label>
                    <div className="select-wrapper">
                      <select
                        value={selectedTheme}
                        onChange={(e) => setSelectedTheme(e.target.value)}
                        className="model-select"
                      >
                        <option value="nordic">北欧极简 (Nordic Frost)</option>
                        <option value="midnight">黑客帝国 (Midnight Matrix)</option>
                        <option value="ocean">商务蔚蓝 (Business Ocean)</option>
                        <option value="sunset">落日余晖 (Sunset Horizon)</option>
                        <option value="purple">流光极光 (Aero Purple)</option>
                      </select>
                    </div>
                  </div>

                  <div className="config-group">
                    <label className="config-label">默认品牌主色调</label>
                    <div className="select-wrapper">
                      <select
                        value={selectedPalette}
                        onChange={(e) => setSelectedPalette(e.target.value)}
                        className="model-select"
                      >
                        <option value="cyan">湖蓝色 (Teal Cyan)</option>
                        <option value="green">科技绿 (Tech Green)</option>
                        <option value="purple">薰衣紫 (Violet Purple)</option>
                        <option value="orange">珊瑚橙 (Sunset Orange)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Global Brand Watermark Logo */}
                <div className="config-group" style={{ marginTop: "8px" }}>
                  <label className="config-label">全局品牌水印 Logo 注入</label>
                  {logoUrl ? (
                    <div className="logo-preview-box justify-between flex items-center" style={{ width: "100%" }}>
                      <img src={logoUrl} alt="Logo" className="brand-logo-img" style={{ maxHeight: 20 }} />
                      <button className="remove-logo-btn" onClick={onRemoveLogo}>
                        移除 Logo
                      </button>
                    </div>
                  ) : (
                    <div className="logo-dropzone" onClick={handleLogoUploadReal} style={{ padding: "16px", width: "100%" }}>
                      <input
                        type="file"
                        ref={logoFileInputRef}
                        onChange={handleLogoFileChange}
                        accept="image/*"
                        style={{ display: "none" }}
                      />
                      <SparklesIcon size={20} className="upload-icon" />
                      <span>点击选择并上传品牌 Logo 标志</span>
                      <span className="sub">Agent 自动排版时将置于页面右上角</span>
                    </div>
                  )}
                </div>

              </div>
            </div>

          </div>
        )}

        {/* ==================== 3. 外观定制：界面个性化 ==================== */}
        {activeCategory === "appearance" && (
          <div className="settings-panel-fade" style={{ display: "grid", gap: "20px" }}>
            
            {/* Theme Mode Card Selector */}
            <div className="settings-card">
              <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", fontWeight: "600" }}>系统主题框架模式 (Theme Mode Selectors)</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                
                {/* Light theme selector */}
                <button
                  className={`theme-mode-card-btn ${themeMode === "light" ? "active" : ""}`}
                  onClick={() => setThemeMode("light")}
                  style={{
                    background: "var(--bg-input-field)",
                    border: themeMode === "light" ? "2px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                    borderRadius: "8px",
                    padding: "16px 12px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    transition: "var(--transition-smooth)"
                  }}
                >
                  <div style={{ width: "100%", height: "40px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", display: "flex" }}>
                    <div style={{ width: "25%", background: "#e5e7eb", borderRight: "1px solid #d1d5db" }}></div>
                    <div style={{ flex: 1, padding: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <div style={{ width: "50%", height: "4px", background: "#9ca3af", borderRadius: "1px" }}></div>
                      <div style={{ width: "80%", height: "3px", background: "#d1d5db", borderRadius: "1px" }}></div>
                    </div>
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-primary)" }}>☀️ 浅色模式</span>
                </button>

                {/* Dark theme selector */}
                <button
                  className={`theme-mode-card-btn ${themeMode === "dark" ? "active" : ""}`}
                  onClick={() => setThemeMode("dark")}
                  style={{
                    background: "var(--bg-input-field)",
                    border: themeMode === "dark" ? "2px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                    borderRadius: "8px",
                    padding: "16px 12px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    transition: "var(--transition-smooth)"
                  }}
                >
                  <div style={{ width: "100%", height: "40px", background: "#111827", border: "1px solid #374151", borderRadius: "4px", display: "flex" }}>
                    <div style={{ width: "25%", background: "#1f2937", borderRight: "1px solid #374151" }}></div>
                    <div style={{ flex: 1, padding: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <div style={{ width: "50%", height: "4px", background: "#4b5563", borderRadius: "1px" }}></div>
                      <div style={{ width: "80%", height: "3px", background: "#374151", borderRadius: "1px" }}></div>
                    </div>
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-primary)" }}>🌙 深色模式</span>
                </button>

                {/* System theme selector */}
                <button
                  className={`theme-mode-card-btn ${themeMode === "system" ? "active" : ""}`}
                  onClick={() => setThemeMode("system")}
                  style={{
                    background: "var(--bg-input-field)",
                    border: themeMode === "system" ? "2px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                    borderRadius: "8px",
                    padding: "16px 12px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    transition: "var(--transition-smooth)"
                  }}
                >
                  <div style={{ width: "100%", height: "40px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", display: "flex", position: "relative", overflow: "hidden" }}>
                    <div style={{ width: "50%", height: "100%", background: "#111827", borderRight: "1px solid #374151", position: "absolute", right: 0, top: 0 }}></div>
                    <div style={{ width: "25%", background: "#e5e7eb", borderRight: "1px solid #d1d5db" }}></div>
                    <div style={{ flex: 1, padding: "4px", zIndex: 2 }}>
                      <div style={{ width: "40%", height: "4px", background: "#9ca3af", borderRadius: "1px" }}></div>
                    </div>
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-primary)" }}>🖥️ 跟随系统</span>
                </button>

              </div>
            </div>

            {/* App Shell Aesthetics Adjustments */}
            <div className="settings-card">
              <h4 style={{ margin: "0 0 16px 0", fontSize: "14px", fontWeight: "600" }}>物理视觉与外壳视效控制阀 (App Shell Aesthetics Adjustments)</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                
                {/* Border radius scale slider */}
                <div className="config-group">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label className="config-label" style={{ margin: 0 }}>外壳与画布圆角收缩比例 (Border Radius Scale)</label>
                    <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--accent-cyan)" }}>
                      {borderRadiusScale.toFixed(2)}x ({Math.round(18 * borderRadiusScale)}px)
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.4"
                    max="2.2"
                    step="0.1"
                    value={borderRadiusScale}
                    onChange={(e) => setBorderRadiusScale(parseFloat(e.target.value))}
                    style={{
                      width: "100%",
                      accentColor: "var(--accent-cyan)",
                      cursor: "pointer",
                      height: "6px",
                      background: "var(--border-glass)",
                      borderRadius: "3px"
                    }}
                  />
                  <span className="config-help">缩小时边缘呈锐利硬角商务风，放大时呈现气泡圆角科技感。</span>
                </div>

                {/* Color Contrast offset slider */}
                <div className="config-group" style={{ borderTop: "1px solid var(--border-glass)", paddingTop: "20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label className="config-label" style={{ margin: 0 }}>双层色彩对比明暗偏置 (Color Contrast Offset)</label>
                    <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--accent-cyan)" }}>
                      {colorContrastOffset > 0 ? `+${colorContrastOffset}` : colorContrastOffset}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-10"
                    max="15"
                    step="1"
                    value={colorContrastOffset}
                    onChange={(e) => setColorContrastOffset(parseInt(e.target.value))}
                    style={{
                      width: "100%",
                      accentColor: "var(--accent-cyan)",
                      cursor: "pointer",
                      height: "6px",
                      background: "var(--border-glass)",
                      borderRadius: "3px"
                    }}
                  />
                  <span className="config-help">拉大对比度可让外壳与右侧画布的层级边界更清晰，反之趋于扁平一体化。</span>
                </div>

              </div>
            </div>

            {/* Realtime aesthetic preview box */}
            <div className="settings-card" style={{ display: "flex", flexDirection: "column", gap: "10px", background: "var(--bg-darker)" }}>
              <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em" }}>视效控制阀 实时预览：</span>
              <div style={{
                display: "flex",
                gap: "12px",
                alignItems: "center",
                padding: "16px",
                borderRadius: `calc(12px * ${borderRadiusScale})`,
                background: "var(--bg-input-field)",
                border: "1px solid var(--border-glass-focused)",
                boxShadow: "var(--shadow-premium)"
              }}>
                <div style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: `calc(6px * ${borderRadiusScale})`,
                  background: "var(--accent-cyan-glow)",
                  color: "var(--accent-cyan)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: "14px"
                }}>
                  ✨
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>Agent Canvas Card</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>随物理圆角滑块缩放的演示卡片</div>
                </div>
                <div style={{
                  padding: "4px 8px",
                  borderRadius: `calc(10px * ${borderRadiusScale})`,
                  background: "var(--border-glass)",
                  fontSize: "10px",
                  color: "var(--text-secondary)",
                  fontWeight: "600"
                }}>
                  Active
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
