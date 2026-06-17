import React from "react";
import { useProjectStore } from "./project-store";

export const DiffReviewZone: React.FC = () => {
  const proposedPatch = useProjectStore((state) => state.proposedPatch);
  const acceptPatch = useProjectStore((state) => state.acceptPatch);
  const rejectPatch = useProjectStore((state) => state.rejectPatch);

  if (!proposedPatch) return null;

  const { targetFile, op, contentBefore, contentAfter, summary } = proposedPatch;

  // Simple diff highlighting lines
  const renderDiffLines = () => {
    const beforeLines = contentBefore.split("\n");
    const afterLines = contentAfter.split("\n");

    return (
      <div style={{ display: "flex", width: "100%", gap: "16px", flex: 1, overflowY: "auto" }}>
        {/* Before Column */}
        <div style={{
          flex: 1,
          background: "rgba(239, 68, 68, 0.03)",
          border: "1px solid rgba(239, 68, 68, 0.15)",
          borderRadius: "8px",
          padding: "16px",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          lineHeight: "1.6",
          overflowX: "auto"
        }}>
          <h5 style={{ margin: "0 0 10px 0", color: "#f87171", fontSize: "11px", fontWeight: 700 }}>变更前 (BEFORE)</h5>
          {beforeLines.map((l, i) => (
            <div key={i} style={{
              background: "rgba(239, 68, 68, 0.05)",
              color: "#fca5a5",
              padding: "2px 4px",
              borderRadius: "2px",
              marginBottom: "2px",
              whiteSpace: "pre-wrap"
            }}>
              - {l}
            </div>
          ))}
        </div>

        {/* After Column */}
        <div style={{
          flex: 1,
          background: "rgba(16, 185, 129, 0.03)",
          border: "1px solid rgba(16, 185, 129, 0.15)",
          borderRadius: "8px",
          padding: "16px",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          lineHeight: "1.6",
          overflowX: "auto"
        }}>
          <h5 style={{ margin: "0 0 10px 0", color: "#34d399", fontSize: "11px", fontWeight: 700 }}>变更后 (AFTER)</h5>
          {afterLines.map((l, i) => (
            <div key={i} style={{
              background: "rgba(16, 185, 129, 0.05)",
              color: "#6ee7b7",
              padding: "2px 4px",
              borderRadius: "2px",
              marginBottom: "2px",
              whiteSpace: "pre-wrap"
            }}>
              + {l}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="diff-review-zone" style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "var(--bg-canvas)",
      zIndex: 100,
      borderRadius: "16px",
      border: "1px solid var(--border-glass)",
      padding: "24px",
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }}>
      {/* 顶部标题与摘要 */}
      <div style={{ borderBottom: "1px solid var(--border-glass)", paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{
            fontSize: "10px",
            background: "rgba(245, 158, 11, 0.1)",
            color: "#f59e0b",
            padding: "2px 6px",
            borderRadius: "4px",
            fontWeight: 700
          }}>
            PATCH PROPOSAL
          </span>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            目标文件: {targetFile}
          </span>
        </div>
        <h3 style={{ margin: "8px 0 4px 0", fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
          AI 建议修改此文件
        </h3>
        {summary && (
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.4" }}>
            修改说明: {summary}
          </p>
        )}
      </div>

      {/* Diff 内容比对 */}
      {renderDiffLines()}

      {/* 底部悬浮控制条 */}
      <div style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: "12px",
        borderTop: "1px solid var(--border-glass)",
        paddingTop: "16px"
      }}>
        <button
          onClick={rejectPatch}
          className="secondary-btn danger"
          style={{
            padding: "10px 20px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          拒绝变更提案 (Reject)
        </button>
        <button
          onClick={acceptPatch}
          className="primary-btn"
          style={{
            padding: "10px 20px",
            background: "var(--accent-cyan)",
            border: "none",
            borderRadius: "8px",
            color: "#fff",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(14, 165, 233, 0.2)"
          }}
        >
          确认接受合并 (Accept Change)
        </button>
      </div>
    </div>
  );
};
