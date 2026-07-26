import React from "react";
import {
  BrainIcon,
  ChevronRightIcon,
  HistoryIcon,
  PaletteIcon,
  SettingsIcon,
} from "./Icons";
import type { SettingsCategory } from "../settingsCategories";

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
    title: string;
    icon: React.ReactNode;
    items: Array<{
      id: SettingsSidebarProps["activeCategory"];
      title: string;
    }>;
  }> = [
    {
      title: "模型与 AI 服务",
      icon: <BrainIcon size={17} />,
      items: [
        { id: "models-list", title: "模型列表" },
        { id: "models-search", title: "搜索与联网" },
        { id: "models-runtime", title: "运行参数" },
      ],
    },
    {
      title: "偏好与演示规范",
      icon: <PaletteIcon size={17} />,
      items: [
        { id: "preferences-presentation", title: "演示文档默认项" },
        { id: "preferences-storage", title: "存储与目录" },
        { id: "preferences-appearance", title: "界面外观 (UI)" },
      ],
    },
    {
      title: "Agent 机制与日志",
      icon: <SettingsIcon size={17} />,
      items: [
        { id: "agent-approval", title: "提交与审批" },
        { id: "agent-limits", title: "调用频率限制" },
        { id: "agent-logs", title: "系统日志" },
      ],
    },
    {
      title: "用量与费用",
      icon: <HistoryIcon size={17} />,
      items: [
        { id: "usage-overview", title: "用量统计与趋势" },
      ],
    },
  ];

  return (
    <aside className="left-panel settings-sidebar">
      <div className="sections-container flex-1">
        <nav className="settings-nav-list" aria-label="设置导航">
          {navItems.map((group) => (
            <div className="settings-nav-group" key={group.title}>
              <div className="settings-nav-group-title">
                <span className="nav-icon-wrapper">{group.icon}</span>
                <span>{group.title}</span>
              </div>
              <div className="settings-nav-submenu">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={`settings-nav-item ${activeCategory === item.id ? "active" : ""}`}
                    onClick={() => onSelectCategory(item.id)}
                    aria-current={activeCategory === item.id ? "page" : undefined}
                  >
                    <span className="settings-nav-bullet" aria-hidden="true" />
                    <span className="nav-title">{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
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
