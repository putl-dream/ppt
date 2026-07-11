import React from "react";
import {
  BrainIcon,
  ChevronRightIcon,
  DownloadIcon,
  FolderIcon,
  KeyIcon,
  PaletteIcon,
  UserIcon,
} from "./Icons";

type SettingsCategory = "account" | "models" | "gateway" | "generation" | "project" | "appearance";

interface SettingsSidebarProps {
  activeCategory: SettingsCategory;
  onSelectCategory: (category: SettingsCategory) => void;
  onBackToWorkspace: () => void;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  activeCategory,
  onSelectCategory,
  onBackToWorkspace,
}) => {
  const navItems: Array<{
    id: SettingsSidebarProps["activeCategory"];
    title: string;
    icon: React.ReactNode;
  }> = [
    { id: "account", title: "账户与额度", icon: <UserIcon size={17} /> },
    { id: "generation", title: "生成与保存", icon: <DownloadIcon size={17} /> },
    { id: "project", title: "文件与模板", icon: <FolderIcon size={17} /> },
    { id: "appearance", title: "外观", icon: <PaletteIcon size={17} /> },
    { id: "models", title: "AI 服务", icon: <BrainIcon size={17} /> },
    { id: "gateway", title: "高级参数", icon: <KeyIcon size={17} /> },
  ];

  return (
    <aside className="left-panel settings-sidebar">
      <div className="sections-container flex-1">
        <div className="settings-nav-list">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`settings-nav-item ${activeCategory === item.id ? "active" : ""}`}
              onClick={() => onSelectCategory(item.id)}
            >
              <div className="nav-icon-wrapper">{item.icon}</div>
              <div className="nav-text">
                <span className="nav-title">{item.title}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-footer left-footer settings-sidebar-footer">
        <button
          className="back-workspace-btn"
          onClick={onBackToWorkspace}
          aria-label="返回 Agent 工作区"
        >
          <ChevronRightIcon size={15} className="settings-back-icon" />
          <span>返回 Agent 工作区</span>
        </button>
      </div>
    </aside>
  );
};
