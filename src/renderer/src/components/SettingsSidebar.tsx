import React from "react";
import { BrainIcon, SettingsIcon, UserIcon, PaletteIcon } from "./Icons";

interface SettingsSidebarProps {
  activeCategory: "profile" | "models" | "workflow" | "appearance";
  onSelectCategory: (category: "profile" | "models" | "workflow" | "appearance") => void;
  onBackToWorkspace: () => void;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  activeCategory,
  onSelectCategory,
  onBackToWorkspace,
}) => {
  return (
    <aside className="left-panel settings-sidebar">
      {/* 顶部标题 */}
      <div className="panel-header left-header">
        <div className="title-section">
          <span className="eyebrow">SYSTEM SETTINGS</span>
          <h2 className="project-title" style={{ cursor: "default" }}>
            <span>系统设置</span>
          </h2>
        </div>
      </div>

      {/* 分类导航列表 */}
      <div className="sections-container flex-1">
        <div className="settings-nav-list" style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
          
          <button
            className={`settings-nav-item ${activeCategory === "profile" ? "active" : ""}`}
            onClick={() => onSelectCategory("profile")}
          >
            <div className="nav-icon-wrapper">
              <UserIcon size={18} />
            </div>
            <div className="nav-text">
              <span className="nav-title">账户与 Token 额度</span>
            </div>
          </button>

          <button
            className={`settings-nav-item ${activeCategory === "models" ? "active" : ""}`}
            onClick={() => onSelectCategory("models")}
          >
            <div className="nav-icon-wrapper">
              <BrainIcon size={18} />
            </div>
            <div className="nav-text">
              <span className="nav-title">自定义模型</span>
            </div>
          </button>
          
          <button
            className={`settings-nav-item ${activeCategory === "workflow" ? "active" : ""}`}
            onClick={() => onSelectCategory("workflow")}
          >
            <div className="nav-icon-wrapper">
              <SettingsIcon size={18} />
            </div>
            <div className="nav-text">
              <span className="nav-title">常规与工作流偏好</span>
            </div>
          </button>

          <button
            className={`settings-nav-item ${activeCategory === "appearance" ? "active" : ""}`}
            onClick={() => onSelectCategory("appearance")}
          >
            <div className="nav-icon-wrapper">
              <PaletteIcon size={18} />
            </div>
            <div className="nav-text">
              <span className="nav-title">外观与视觉控制</span>
            </div>
          </button>
          
        </div>
      </div>

      {/* 底部返回工作区按钮 */}
      <div className="panel-footer left-footer" style={{ padding: "16px 18px" }}>
        <button
          className="back-workspace-btn"
          onClick={onBackToWorkspace}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "11px 14px",
            borderRadius: "8px",
            border: "1px solid var(--border-glass-focused)",
            background: "var(--bg-input-field)",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
            transition: "var(--transition-smooth)",
            boxShadow: "0 2px 6px rgba(0,0,0,0.03)"
          }}
        >
          <span>← 返回 Agent 工作区</span>
        </button>
      </div>
    </aside>
  );
};
