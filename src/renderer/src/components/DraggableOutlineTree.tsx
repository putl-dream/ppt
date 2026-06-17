import React, { useState, useEffect } from "react";
import { useProjectStore } from "./project-store";

interface OutlineItem {
  id: string;
  title: string;
  pages: number;
  points: string[];
}

export const DraggableOutlineTree: React.FC = () => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const updateArtifactContent = useProjectStore((state) => state.updateArtifactContent);
  const markStageReady = useProjectStore((state) => state.markStageReady);

  if (!activeProject) return null;

  const outlineArtifact = activeProject.artifacts.outline;

  // Simple parser for outline markdown
  const parseOutlineMarkdown = (md: string): OutlineItem[] => {
    const items: OutlineItem[] = [];
    const lines = md.split("\n");
    let currentItem: OutlineItem | null = null;

    lines.forEach((line) => {
      const headerMatch = line.match(/^##\s+\d*\.?\s*(.*?)\s*(?:\[预计\s*(\d+)\s*页\])?\s*$/);
      if (headerMatch) {
        if (currentItem) items.push(currentItem);
        currentItem = {
          id: Math.random().toString(36).substr(2, 9),
          title: headerMatch[1].trim(),
          pages: headerMatch[2] ? parseInt(headerMatch[2]) : 1,
          points: []
        };
      } else {
        const pointMatch = line.match(/^[-*]\s*(.*)$/);
        if (pointMatch && currentItem) {
          currentItem.points.push(pointMatch[1].trim());
        }
      }
    });

    if (currentItem) items.push(currentItem);

    // Fallback if empty
    if (items.length === 0) {
      return [
        { id: "1", title: "行业背景与痛点", pages: 1, points: ["痛点一", "痛点二"] }
      ];
    }

    return items;
  };

  const [items, setItems] = useState<OutlineItem[]>(() => parseOutlineMarkdown(outlineArtifact.content));

  useEffect(() => {
    setItems(parseOutlineMarkdown(outlineArtifact.content));
  }, [outlineArtifact.content]);

  // Compile back to Markdown and save
  const saveItems = (newItems: OutlineItem[]) => {
    setItems(newItems);
    const markdown = `# 演示大纲\n\n` + newItems.map((item, index) => {
      let head = `## ${index + 1}. ${item.title}`;
      if (item.pages) head += ` [预计 ${item.pages} 页]`;
      const points = item.points.map((p) => `- ${p}`).join("\n");
      return `${head}\n${points}`;
    }).join("\n\n") + "\n";

    updateArtifactContent("outline", markdown);
  };

  const updateItemTitle = (id: string, newTitle: string) => {
    const next = items.map((item) => item.id === id ? { ...item, title: newTitle } : item);
    saveItems(next);
  };

  const updateItemPages = (id: string, pages: number) => {
    const next = items.map((item) => item.id === id ? { ...item, pages: Math.max(1, pages) } : item);
    saveItems(next);
  };

  const updateItemPoint = (id: string, pointIdx: number, val: string) => {
    const next = items.map((item) => {
      if (item.id === id) {
        const pts = [...item.points];
        pts[pointIdx] = val;
        return { ...item, points: pts };
      }
      return item;
    });
    saveItems(next);
  };

  const addItemPoint = (id: string) => {
    const next = items.map((item) => {
      if (item.id === id) {
        return { ...item, points: [...item.points, "新要点"] };
      }
      return item;
    });
    saveItems(next);
  };

  const deleteItemPoint = (id: string, pointIdx: number) => {
    const next = items.map((item) => {
      if (item.id === id) {
        const pts = item.points.filter((_, i) => i !== pointIdx);
        return { ...item, points: pts };
      }
      return item;
    });
    saveItems(next);
  };

  const addNewSection = () => {
    const newItem: OutlineItem = {
      id: Math.random().toString(36).substr(2, 9),
      title: "新大纲章节",
      pages: 1,
      points: ["要点一"]
    };
    saveItems([...items, newItem]);
  };

  const deleteSection = (id: string) => {
    saveItems(items.filter((item) => item.id !== id));
  };

  // Reordering helpers
  const moveSection = (index: number, direction: "up" | "down") => {
    const targetIdx = index + (direction === "up" ? -1 : 1);
    if (targetIdx < 0 || targetIdx >= items.length) return;

    const list = [...items];
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;
    
    saveItems(list);
  };

  const handleConfirmReady = () => {
    markStageReady("outline");
  };

  return (
    <div className="draggable-outline-tree" style={{
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
            🗂️ 内容大纲管理 (Outline)
          </h2>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            规划演示文稿的章节逻辑，并设置每节预计幻灯片页数
          </span>
        </div>

        <button
          onClick={addNewSection}
          className="secondary-btn"
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            cursor: "pointer"
          }}
        >
          ➕ 添加新章节
        </button>
      </div>

      {/* 章节卡片列表 */}
      <div className="outline-cards-list" style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1 }}>
        {items.map((item, index) => (
          <div
            key={item.id}
            className="outline-item-card"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--border-glass)",
              borderRadius: "12px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--accent-cyan)" }}>
                  #{index + 1}
                </span>
                <input
                  type="text"
                  value={item.title}
                  onChange={(e) => updateItemTitle(item.id, e.target.value)}
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid transparent",
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    padding: "2px 4px",
                    flex: 1,
                    outline: "none"
                  }}
                  onFocus={(e) => e.target.style.borderBottomColor = "var(--accent-cyan)"}
                  onBlur={(e) => e.target.style.borderBottomColor = "transparent"}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {/* 预计页数 */}
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>预计</span>
                  <input
                    type="number"
                    value={item.pages}
                    onChange={(e) => updateItemPages(item.id, parseInt(e.target.value) || 1)}
                    style={{
                      width: "40px",
                      background: "var(--bg-darker)",
                      border: "1px solid var(--border-glass)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                      textAlign: "center",
                      fontSize: "12px",
                      padding: "2px",
                      outline: "none"
                    }}
                    min={1}
                  />
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>页</span>
                </div>

                {/* 排序及删除按钮 */}
                <div style={{ display: "flex", gap: "4px" }}>
                  <button
                    disabled={index === 0}
                    onClick={() => moveSection(index, "up")}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", opacity: index === 0 ? 0.3 : 1 }}
                    title="上移"
                  >
                    ▲
                  </button>
                  <button
                    disabled={index === items.length - 1}
                    onClick={() => moveSection(index, "down")}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", opacity: index === items.length - 1 ? 0.3 : 1 }}
                    title="下移"
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => deleteSection(item.id)}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-danger, #ef4444)", marginLeft: "8px" }}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* 要点列表 */}
            <div className="outline-points-list" style={{ paddingLeft: "24px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {item.points.map((pt, pIdx) => (
                <div key={pIdx} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "var(--text-muted)" }}>•</span>
                  <input
                    type="text"
                    value={pt}
                    onChange={(e) => updateItemPoint(item.id, pIdx, e.target.value)}
                    style={{
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px dashed transparent",
                      fontSize: "13px",
                      color: "var(--text-secondary)",
                      flex: 1,
                      outline: "none",
                      padding: "2px"
                    }}
                    onFocus={(e) => e.target.style.borderBottomColor = "var(--border-glass-focused)"}
                    onBlur={(e) => e.target.style.borderBottomColor = "transparent"}
                  />
                  <button
                    onClick={() => deleteItemPoint(item.id, pIdx)}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "11px" }}
                    title="删除要点"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => addItemPoint(item.id)}
                style={{
                  alignSelf: "flex-start",
                  background: "transparent",
                  border: "none",
                  color: "var(--accent-cyan)",
                  fontSize: "12px",
                  cursor: "pointer",
                  padding: "4px 0",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px"
                }}
              >
                ➕ 添加要点
              </button>
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
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px"
          }}
        >
          确认大纲并解锁下游 (Ready)
        </button>
      </div>
    </div>
  );
};
