import React, { useState, useEffect } from "react";
import { useProjectStore } from "./project-store";

interface SlidePlan {
  title: string;
  layout: string;
  keyPoints: string[];
  quote: string;
}

export const StoryboardGrid: React.FC = () => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const updateArtifactContent = useProjectStore((state) => state.updateArtifactContent);
  const markStageReady = useProjectStore((state) => state.markStageReady);

  if (!activeProject) return null;

  const slidesArtifact = activeProject.artifacts.slides;

  const parseSlidesJson = (content: string): SlidePlan[] => {
    try {
      return JSON.parse(content);
    } catch {
      return [
        { title: "封面", layout: "cover", keyPoints: ["智能硬件市场推广", "主讲人: AI 助手"], quote: "" }
      ];
    }
  };

  const [slides, setSlides] = useState<SlidePlan[]>(() => parseSlidesJson(slidesArtifact.content));

  useEffect(() => {
    setSlides(parseSlidesJson(slidesArtifact.content));
  }, [slidesArtifact.content]);

  const saveSlides = (newSlides: SlidePlan[]) => {
    setSlides(newSlides);
    updateArtifactContent("slides", JSON.stringify(newSlides, null, 2));
  };

  const updateSlideField = (index: number, field: keyof SlidePlan, val: any) => {
    const next = [...slides];
    next[index] = { ...next[index], [field]: val };
    saveSlides(next);
  };

  const updatePoint = (slideIdx: number, pointIdx: number, val: string) => {
    const next = [...slides];
    const pts = [...next[slideIdx].keyPoints];
    pts[pointIdx] = val;
    next[slideIdx].keyPoints = pts;
    saveSlides(next);
  };

  const addPoint = (slideIdx: number) => {
    const next = [...slides];
    next[slideIdx].keyPoints = [...next[slideIdx].keyPoints, "新要点内容"];
    saveSlides(next);
  };

  const removePoint = (slideIdx: number, pointIdx: number) => {
    const next = [...slides];
    next[slideIdx].keyPoints = next[slideIdx].keyPoints.filter((_, i) => i !== pointIdx);
    saveSlides(next);
  };

  const addSlide = () => {
    const newSlide: SlidePlan = {
      title: "新幻灯片页",
      layout: "concept",
      keyPoints: ["核心信息点描述"],
      quote: ""
    };
    saveSlides([...slides, newSlide]);
  };

  const removeSlide = (index: number) => {
    if (slides.length <= 1) return;
    saveSlides(slides.filter((_, i) => i !== index));
  };

  const layouts = [
    { value: "cover", label: "封面排版" },
    { value: "section", label: "过渡页" },
    { value: "concept", label: "概念大图" },
    { value: "comparison", label: "左右对比" },
    { value: "process", label: "流程步骤" },
    { value: "architecture", label: "分层架构" },
    { value: "case", label: "案例展示" },
    { value: "summary", label: "总结要点" }
  ];

  const handleConfirmReady = () => {
    markStageReady("slides");
  };

  return (
    <div className="storyboard-grid-container" style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--bg-canvas)",
      borderRadius: "16px",
      border: "1px solid var(--border-glass)",
      padding: "24px",
      overflowY: "auto"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
            Storyboard Grid (逐页大纲方案)
          </h2>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            为每一页幻灯片单独规划结构内容、排版布局、核心要点以及引用的事实
          </span>
        </div>

        <button
          onClick={addSlide}
          className="secondary-btn"
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            fontSize: "12px",
            cursor: "pointer"
          }}
        >
          ➕ 新增单页方案
        </button>
      </div>

      {/* 卡片网格 */}
      <div className="slides-storyboard-grid" style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: "20px",
        flex: 1,
        alignContent: "flex-start"
      }}>
        {slides.map((slide, index) => (
          <div
            key={index}
            className="storyboard-card"
            style={{
              background: "rgba(255, 255, 255, 0.01)",
              border: "1px solid var(--border-glass)",
              borderRadius: "12px",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              position: "relative"
            }}
          >
            {/* 卡片顶部：页码与删除 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent-cyan)" }}>
                SLIDE {(index + 1).toString().padStart(2, "0")}
              </span>
              <button
                onClick={() => removeSlide(index)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-danger, #ef4444)",
                  fontSize: "12px"
                }}
                disabled={slides.length <= 1}
              >
                ✕ 移除页
              </button>
            </div>

            {/* 页面标题 */}
            <div>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>页面标题</label>
              <input
                type="text"
                value={slide.title}
                onChange={(e) => updateSlideField(index, "title", e.target.value)}
                style={{
                  background: "var(--bg-darker)",
                  border: "1px solid var(--border-glass)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  padding: "6px 10px",
                  width: "100%",
                  outline: "none"
                }}
              />
            </div>

            {/* 页面排版布局 */}
            <div>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>选择布局结构</label>
              <select
                value={slide.layout}
                onChange={(e) => updateSlideField(index, "layout", e.target.value)}
                style={{
                  background: "var(--bg-darker)",
                  border: "1px solid var(--border-glass)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  padding: "6px 10px",
                  width: "100%",
                  outline: "none",
                  cursor: "pointer"
                }}
              >
                {layouts.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            {/* 要点列表 */}
            <div>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>图层要点内容</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {slide.keyPoints.map((pt, ptIdx) => (
                  <div key={ptIdx} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      type="text"
                      value={pt}
                      onChange={(e) => updatePoint(index, ptIdx, e.target.value)}
                      style={{
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px dashed var(--border-glass-focused)",
                        color: "var(--text-secondary)",
                        fontSize: "12px",
                        flex: 1,
                        outline: "none",
                        padding: "2px"
                      }}
                    />
                    <button
                      onClick={() => removePoint(index, ptIdx)}
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "11px" }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addPoint(index)}
                  style={{
                    alignSelf: "flex-start",
                    background: "transparent",
                    border: "none",
                    color: "var(--accent-cyan)",
                    fontSize: "11px",
                    cursor: "pointer",
                    padding: "4px 0"
                  }}
                >
                  ➕ 添加要点
                </button>
              </div>
            </div>

            {/* 素材引用 */}
            <div>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>数据/资料引用引用支撑</label>
              <input
                type="text"
                value={slide.quote}
                onChange={(e) => updateSlideField(index, "quote", e.target.value)}
                style={{
                  background: "var(--bg-darker)",
                  border: "1px dashed var(--border-glass)",
                  borderRadius: "6px",
                  color: "var(--text-muted)",
                  fontSize: "12px",
                  padding: "6px 10px",
                  width: "100%",
                  outline: "none"
                }}
                placeholder="在此粘贴 Research 里的事实数据..."
              />
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end" }}>
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
          确认逐页大纲就绪 (Ready)
        </button>
      </div>
    </div>
  );
};
