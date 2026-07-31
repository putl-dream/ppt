import React, { useMemo, useState } from "react";
import { ChevronRightIcon } from "./Icons";
import type { SettingsCategory } from "../settingsCategories";

interface SettingsSidebarProps {
  activeCategory: SettingsCategory;
  onSelectCategory: (category: SettingsCategory) => void;
  onBackToWorkspace: () => void;
}

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ id: SettingsCategory; title: string }>;
}> = [
  {
    title: "模型与 AI 服务",
    items: [
      { id: "models-list", title: "模型列表" },
      { id: "models-search", title: "搜索与联网" },
      { id: "models-runtime", title: "运行参数" },
    ],
  },
  {
    title: "偏好与演示规范",
    items: [
      { id: "preferences-presentation", title: "演示文档默认项" },
      { id: "preferences-storage", title: "存储与目录" },
      { id: "preferences-appearance", title: "界面外观" },
    ],
  },
  {
    title: "Agent 机制与日志",
    items: [
      { id: "agent-approval", title: "提交与审批" },
      { id: "agent-limits", title: "调用频率限制" },
      { id: "agent-logs", title: "系统日志" },
    ],
  },
  {
    title: "用量与费用",
    items: [
      { id: "usage-overview", title: "用量统计与趋势" },
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
    <aside className="left-panel settings-sidebar">
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
            <div className="ide-nav-group" key={group.title}>
              <div className="ide-nav-group-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`ide-nav-item${activeCategory === item.id ? " is-active" : ""}`}
                  onClick={() => onSelectCategory(item.id)}
                  aria-current={activeCategory === item.id ? "page" : undefined}
                >
                  {item.title}
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
