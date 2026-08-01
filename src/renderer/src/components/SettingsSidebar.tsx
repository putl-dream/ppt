import React, { useMemo, useState } from "react";
import {
  BrainIcon,
  ChartIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  FolderIcon,
  GaugeIcon,
  HistoryIcon,
  LayoutIcon,
  PaletteIcon,
  SearchIcon,
  SlidersIcon,
} from "./Icons";
import type { SettingsCategory } from "../settingsCategories";
import { cx } from "../lib/cx";

interface SettingsSidebarProps {
  activeCategory: SettingsCategory;
  onSelectCategory: (category: SettingsCategory) => void;
  onBackToWorkspace: () => void;
}

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{
    id: SettingsCategory;
    title: string;
    icon: React.ReactNode;
  }>;
}> = [
  {
    title: "常用",
    items: [
      { id: "preferences-appearance", title: "界面外观", icon: <PaletteIcon size={15} /> },
      { id: "models-list", title: "模型", icon: <BrainIcon size={15} /> },
      { id: "usage-overview", title: "用量与费用", icon: <ChartIcon size={15} /> },
    ],
  },
  {
    title: "偏好",
    items: [
      { id: "preferences-presentation", title: "演示与品牌", icon: <LayoutIcon size={15} /> },
      { id: "preferences-storage", title: "存储", icon: <FolderIcon size={15} /> },
    ],
  },
  {
    title: "模型服务",
    items: [
      { id: "models-search", title: "搜索与联网", icon: <SearchIcon size={15} /> },
      { id: "models-runtime", title: "运行参数", icon: <SlidersIcon size={15} /> },
    ],
  },
  {
    title: "Agent",
    items: [
      { id: "agent-approval", title: "提交与审批", icon: <CheckCircleIcon size={15} /> },
      { id: "agent-limits", title: "限流", icon: <GaugeIcon size={15} /> },
      { id: "agent-logs", title: "系统日志", icon: <HistoryIcon size={15} /> },
    ],
  },
];

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  activeCategory,
  onSelectCategory,
  onBackToWorkspace,
}) => {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();

  const visibleGroups = useMemo(() => {
    if (!query) return NAV_GROUPS;
    return NAV_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.title.toLowerCase().includes(query)
          || group.title.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <aside className="left-panel settings-sidebar" data-ui-region="sidebar">
      <div className="sections-container flex-1">
        <nav className="ide-nav" aria-label="设置导航">
          <input
            type="search"
            className="ide-nav-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="筛选设置项…"
            aria-label="筛选设置项"
          />
          {visibleGroups.map((group) => (
            <div
              className="ide-nav-group"
              key={group.title}
              role="group"
              aria-label={group.title}
            >
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx("ide-nav-item", activeCategory === item.id && "is-active")}
                  onClick={() => onSelectCategory(item.id)}
                  aria-current={activeCategory === item.id ? "page" : undefined}
                >
                  <span className="ide-nav-item-icon" aria-hidden="true">{item.icon}</span>
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          ))}
          {visibleGroups.length === 0 ? (
            <p className="ide-hint">没有匹配的设置项</p>
          ) : null}
        </nav>
      </div>

      <div className="panel-footer left-footer settings-sidebar-footer">
        <button
          type="button"
          className="ide-nav-back"
          onClick={onBackToWorkspace}
          aria-label="返回工作区"
        >
          <ChevronRightIcon size={14} />
          <span>返回工作区</span>
        </button>
      </div>
    </aside>
  );
};
