import React, { useState, useEffect } from "react";
import { useProjectStore } from "./project-store";

interface ResearchNote {
  id: string;
  source: string;
  quote: string;
}

export const ResearchNotesCollector: React.FC = () => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const updateArtifactContent = useProjectStore((state) => state.updateArtifactContent);
  const markStageReady = useProjectStore((state) => state.markStageReady);

  if (!activeProject) return null;

  const researchArtifact = activeProject.artifacts.research;

  const parseResearchMarkdown = (md: string): ResearchNote[] => {
    const notes: ResearchNote[] = [];
    const lines = md.split("\n");
    let currentSource = "外部来源";
    
    lines.forEach((line) => {
      const sourceMatch = line.match(/^-\s+\*\*(.*?)\*\*:\s*(.*)$/);
      if (sourceMatch) {
        notes.push({
          id: Math.random().toString(36).substr(2, 9),
          source: sourceMatch[1].trim(),
          quote: sourceMatch[2].trim()
        });
      }
    });

    if (notes.length === 0) {
      return [
        { id: "1", source: "行业背景数据", quote: "2026年全球智能硬件出货量增长预计达到15%。" }
      ];
    }

    return notes;
  };

  const [notes, setNotes] = useState<ResearchNote[]>(() => parseResearchMarkdown(researchArtifact.content));

  useEffect(() => {
    setNotes(parseResearchMarkdown(researchArtifact.content));
  }, [researchArtifact.content]);

  const saveNotes = (newNotes: ResearchNote[]) => {
    setNotes(newNotes);
    const markdown = `# 研究资料与素材\n\n` + newNotes.map((n) => `- **${n.source}**: ${n.quote}`).join("\n") + "\n";
    updateArtifactContent("research", markdown);
  };

  const handleUpdateNote = (id: string, field: "source" | "quote", val: string) => {
    const next = notes.map((n) => n.id === id ? { ...n, [field]: val } : n);
    saveNotes(next);
  };

  const handleAddNote = () => {
    const newNote = {
      id: Math.random().toString(36).substr(2, 9),
      source: "新来源",
      quote: "在此输入提取的资料摘录内容。"
    };
    saveItems([...notes, newNote]);
  };

  const saveItems = (newNotes: ResearchNote[]) => {
    saveNotes(newNotes);
  };

  const handleDeleteNote = (id: string) => {
    saveNotes(notes.filter((n) => n.id !== id));
  };

  const handleConfirmReady = () => {
    markStageReady("research");
  };

  return (
    <div className="research-notes-collector" style={{
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
            🔍 资料与研究素材 (Research Notes)
          </h2>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            摘录客观的市场数据、竞品细节或核心依据，为下游的 Slides 提供引用依据
          </span>
        </div>

        <button
          onClick={handleAddNote}
          className="secondary-btn"
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            fontSize: "12px",
            cursor: "pointer"
          }}
        >
          ➕ 新增摘录
        </button>
      </div>

      {/* 摘录卡片网格 */}
      <div className="notes-grid" style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "16px",
        flex: 1,
        alignContent: "flex-start"
      }}>
        {notes.map((note) => (
          <div
            key={note.id}
            className="research-note-card"
            style={{
              background: "rgba(255, 255, 255, 0.01)",
              border: "1px solid var(--border-glass)",
              borderRadius: "10px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: "12px"
            }}
          >
            <div>
              {/* 来源输入 */}
              <input
                type="text"
                value={note.source}
                onChange={(e) => handleUpdateNote(note.id, "source", e.target.value)}
                style={{
                  background: "var(--bg-darker)",
                  border: "1px solid var(--border-glass)",
                  borderRadius: "4px",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "4px 8px",
                  width: "100%",
                  marginBottom: "8px",
                  outline: "none"
                }}
                placeholder="数据来源/报告名称"
              />
              
              {/* 摘录正文 */}
              <textarea
                value={note.quote}
                onChange={(e) => handleUpdateNote(note.id, "quote", e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  resize: "none",
                  width: "100%",
                  height: "100px",
                  color: "var(--text-secondary)",
                  fontSize: "13px",
                  lineHeight: "1.5",
                  outline: "none"
                }}
                placeholder="摘录内容..."
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => handleDeleteNote(note.id)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-danger, #ef4444)",
                  fontSize: "12px"
                }}
              >
                🗑️ 删除
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
            cursor: "pointer"
          }}
        >
          标记资料就绪 (Ready)
        </button>
      </div>
    </div>
  );
};
