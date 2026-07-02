import React from "react";
import { useProjectStore, ArtifactId, ArtifactStatus } from "../project-store";

interface ProjectNavigatorProps {
  onToggleSettings?: () => void;
}

export const ProjectNavigator: React.FC<ProjectNavigatorProps> = ({
  onToggleSettings,
}) => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const currentStage: ArtifactId = "brief";
  const setStage = (_stage: ArtifactId) => {};

  if (!activeProject) {
    return (
      <div className="project-navigator-empty" style={{ padding: "20px", color: "var(--text-muted)", fontSize: "13px" }}>
        暂无激活的项目
      </div>
    );
  }

  const { artifacts } = activeProject;

  const stages: Array<{ id: ArtifactId; name: string; label: string; desc: string }> = [
    { id: "brief", name: "Brief", label: "目的与听众", desc: "收集首屏Brief采集" },
    { id: "outline", name: "Outline", label: "内容大纲", desc: "生成并规划幻灯片大纲" },
    { id: "research", name: "Research", label: "资料收集", desc: "提取并收集主题相关的研究素材" },
    { id: "design", name: "Design", label: "设计系统", desc: "配置主题风格、色系与Logo" },
    { id: "slides", name: "Slides Plan", label: "逐页方案", desc: "规划单页卡片内容与引用" },
    { id: "deck", name: "Deck", label: "PPT预览与导出", desc: "渲染排版方案并导出PPT" },
  ];

  const getStatusBadge = (status: ArtifactStatus) => {
    switch (status) {
      case "ready":
        return (
          <span className="art-status-badge ready" style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
            color: "#10b981",
            background: "rgba(16, 185, 129, 0.1)",
            padding: "2px 6px",
            borderRadius: "10px",
            fontWeight: 500
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Ready
          </span>
        );
      case "stale":
        return (
          <span className="art-status-badge stale" style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
            color: "#f59e0b",
            background: "rgba(245, 158, 11, 0.1)",
            padding: "2px 6px",
            borderRadius: "10px",
            fontWeight: 500
          }}>
            <span className="stale-pulse-dot" style={{
              width: "6px",
              height: "6px",
              background: "#f59e0b",
              borderRadius: "50%",
              display: "inline-block"
            }} />
            Stale
          </span>
        );
      case "draft":
      default:
        return (
          <span className="art-status-badge draft" style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
            color: "var(--text-muted)",
            background: "rgba(255, 255, 255, 0.05)",
            padding: "2px 6px",
            borderRadius: "10px",
            fontWeight: 500
          }}>
            Draft
          </span>
        );
    }
  };

  return (
    <div className="project-navigator-container" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 顶部标题 */}
      <div className="navigator-header" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-glass)" }}>
        <span className="eyebrow" style={{ fontSize: "10px", color: "var(--text-muted)", letterSpacing: "0.15em" }}>PROJECT PIPELINE</span>
        <h3 style={{ margin: "4px 0 0 0", fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>
          {activeProject.name || "未命名演示文稿"}
        </h3>
      </div>

      {/* 阶段列表 */}
      <div className="navigator-stages-list" style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto" }}>
        {stages.map((stage) => {
          const isActive = currentStage === stage.id;
          const status = artifacts[stage.id]?.status || "draft";
          
          // Custom border pulse animation style if stale
          const stalePulseStyle: React.CSSProperties = status === "stale" ? {
            border: "1px dashed rgba(245, 158, 11, 0.4)",
            boxShadow: "0 0 8px rgba(245, 158, 11, 0.08)",
            animation: "stalePulse 2s infinite"
          } : {};

          return (
            <div
              key={stage.id}
              onClick={() => setStage(stage.id)}
              className={`stage-nav-card ${isActive ? "active" : ""} status-${status}`}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "12px 16px",
                borderRadius: "12px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                background: isActive ? "var(--border-glass-focused)" : "rgba(255, 255, 255, 0.01)",
                border: isActive ? "1px solid var(--accent-cyan)" : "1px solid var(--border-glass)",
                ...stalePulseStyle
              }}
            >
              <div className="stage-card-top" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span className="stage-name" style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)"
                }}>
                  {stage.label}
                </span>
                {getStatusBadge(status)}
              </div>
              <span className="stage-desc" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                {stage.desc}
              </span>
            </div>
          );
        })}
      </div>

      {/* 导航脉波 CSS 注入 */}
      <style>{`
        @keyframes stalePulse {
          0% {
            border-color: rgba(245, 158, 11, 0.3);
            box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.15);
          }
          70% {
            border-color: rgba(245, 158, 11, 0.6);
            box-shadow: 0 0 0 6px rgba(245, 158, 11, 0);
          }
          100% {
            border-color: rgba(245, 158, 11, 0.3);
            box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
          }
        }
      `}</style>
    </div>
  );
};
