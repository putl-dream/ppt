import React, { useState, useEffect } from "react";
import { useProjectStore } from "./project-store";

export const DesignThemeSelector: React.FC = () => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const updateArtifactContent = useProjectStore((state) => state.updateArtifactContent);
  const markStageReady = useProjectStore((state) => state.markStageReady);

  if (!activeProject) return null;

  const designArtifact = activeProject.artifacts.design;

  const parseDesignJson = (content: string) => {
    try {
      return JSON.parse(content);
    } catch {
      return {
        theme: "nordic",
        palette: "cyan",
        logoUrl: null,
        ratio: "16:9"
      };
    }
  };

  const [settings, setSettings] = useState(() => parseDesignJson(designArtifact.content));

  useEffect(() => {
    setSettings(parseDesignJson(designArtifact.content));
  }, [designArtifact.content]);

  const saveSettings = (nextSettings: typeof settings) => {
    setSettings(nextSettings);
    updateArtifactContent("design", JSON.stringify(nextSettings, null, 2));
  };

  const selectTheme = (theme: string) => {
    saveSettings({ ...settings, theme });
  };

  const selectPalette = (palette: string) => {
    saveSettings({ ...settings, palette });
  };

  const selectRatio = (ratio: string) => {
    saveSettings({ ...settings, ratio });
  };

  const handleLogoUploadSimulate = () => {
    saveSettings({
      ...settings,
      logoUrl: "https://www.google.com/images/branding/googlelogo/1x/googlelogo_light_color_272x92dp.png"
    });
  };

  const handleRemoveLogo = () => {
    saveSettings({ ...settings, logoUrl: null });
  };

  const themesList = [
    { id: "nordic", name: "北欧极简", desc: "Serif 字体，高级米白背景", bg: "#fbfbfa", text: "#0f172a" },
    { id: "midnight", name: "极客黑客", desc: "Mono 字体，深灰色科技极简", bg: "#0e1115", text: "#f8fafc" },
    { id: "ocean", name: "商务蔚蓝", desc: "Sans 字体，经典蓝渐变底色", bg: "#0f172a", text: "#f8fafc" },
    { id: "sunset", name: "落日余晖", desc: "Serif 字体，温馨柔和米黄", bg: "#fffcf4", text: "#3c2a21" },
    { id: "purple", name: "流光极光", desc: "Sans 字体，神秘紫暗色调", bg: "#1c1537", text: "#f8fafc" }
  ];

  const palettesList = [
    { id: "cyan", name: "湖蓝", color: "#0ea5e9" },
    { id: "green", name: "科技绿", color: "#10b981" },
    { id: "purple", name: "薰衣紫", color: "#a855f7" },
    { id: "orange", name: "珊瑚橙", color: "#f97316" }
  ];

  const handleConfirmReady = () => {
    markStageReady("design");
  };

  return (
    <div className="design-theme-selector" style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--bg-canvas)",
      borderRadius: "16px",
      border: "1px solid var(--border-glass)",
      padding: "24px",
      overflowY: "auto"
    }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
          🎨 设计系统与板式偏好 (Design Settings)
        </h2>
        <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block", marginBottom: "20px" }}>
          选择设计模版基调、配色方案和品牌标识
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
        
        {/* 模版主题选择 */}
        <div>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "12px" }}>
            主题模版风格
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
            {themesList.map((t) => {
              const isSelected = settings.theme === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => selectTheme(t.id)}
                  style={{
                    background: t.bg,
                    border: isSelected ? "2px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                    borderRadius: "10px",
                    padding: "16px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    height: "100px",
                    boxShadow: isSelected ? "0 4px 12px rgba(14, 165, 233, 0.15)" : "none"
                  }}
                >
                  <span style={{ fontSize: "13px", fontWeight: 600, color: t.text }}>
                    {t.name}
                  </span>
                  <span style={{ fontSize: "10px", color: t.text, opacity: 0.7 }}>
                    {t.desc}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 强调色调选择 */}
        <div>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "12px" }}>
            全局强调色调
          </label>
          <div style={{ display: "flex", gap: "16px" }}>
            {palettesList.map((p) => {
              const isSelected = settings.palette === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => selectPalette(p.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "6px",
                    cursor: "pointer"
                  }}
                >
                  <div style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    background: p.color,
                    border: isSelected ? "3px solid #fff" : "none",
                    boxShadow: isSelected ? `0 0 10px ${p.color}` : "none",
                    transition: "all 0.2s ease"
                  }} />
                  <span style={{ fontSize: "11px", color: isSelected ? "var(--text-primary)" : "var(--text-muted)", fontWeight: isSelected ? 600 : 400 }}>
                    {p.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 画面比例 */}
        <div>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "12px" }}>
            演示文稿尺寸比例
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            {["16:9", "4:3"].map((r) => {
              const isSelected = settings.ratio === r;
              return (
                <button
                  key={r}
                  onClick={() => selectRatio(r)}
                  className={`secondary-btn ${isSelected ? "active" : ""}`}
                  style={{
                    padding: "8px 20px",
                    borderRadius: "6px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: isSelected ? "var(--accent-cyan)" : "transparent",
                    color: isSelected ? "#fff" : "var(--text-secondary)",
                    border: "1px solid var(--border-glass)"
                  }}
                >
                  {r === "16:9" ? "宽屏 16:9 (推荐)" : "标屏 4:3"}
                </button>
              );
            })}
          </div>
        </div>

        {/* 品牌Logo标识 */}
        <div>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "12px" }}>
            品牌 Logo 标识
          </label>
          <div style={{
            background: "rgba(255, 255, 255, 0.01)",
            border: "1px dashed var(--border-glass)",
            borderRadius: "8px",
            padding: "20px",
            display: "flex",
            alignItems: "center",
            gap: "16px"
          }}>
            {settings.logoUrl ? (
              <>
                <img src={settings.logoUrl} alt="Logo" style={{ maxHeight: "36px", opacity: 0.8 }} />
                <button
                  onClick={handleRemoveLogo}
                  className="secondary-btn danger"
                  style={{ padding: "6px 12px", fontSize: "12px" }}
                >
                  移除 Logo
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>未应用任何品牌 Logo</span>
                <button
                  onClick={handleLogoUploadSimulate}
                  className="secondary-btn"
                  style={{ padding: "6px 12px", fontSize: "12px" }}
                >
                  模拟上传 Logo
                </button>
              </>
            )}
          </div>
        </div>

      </div>

      <div style={{ marginTop: "32px", display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleConfirmReady}
          className="primary-btn"
          style={{
            padding: "10px 20px",
            background: "var(--accent-cyan)",
            border: "none",
            borderRadius: "6px",
            color: "#fff",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer"
          }}
        >
          确定设计偏好就绪 (Ready)
        </button>
      </div>
    </div>
  );
};
