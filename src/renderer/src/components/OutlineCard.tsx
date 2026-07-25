import React from "react";
import type { OutlineItem } from "@shared/project-artifacts";
import { ResolvedCard } from "./ResolvedCard";

interface OutlineCardProps {
  items: OutlineItem[];
  resolved?: "confirmed" | "dismissed";
  busy?: boolean;
  onConfirm?: () => void;
  onRevise?: () => void;
}

export const OutlineCard: React.FC<OutlineCardProps> = ({
  items,
  resolved,
  busy,
  onConfirm,
  onRevise,
}) => resolved === "confirmed" ? (
  <ResolvedCard label="内容大纲" title="已确认" detail={`${items.length} 个章节`}>
    <ol className="outline-card-list">
      {items.map((item, index) => (
        <li key={item.id} className="outline-card-item">
          <div className="outline-card-item-title">
            <span className="outline-card-index">{index + 1}</span>
            <span>{item.title}</span>
          </div>
        </li>
      ))}
    </ol>
  </ResolvedCard>
) : (
  <div className="inline-artifact-card outline-card">
    <div className="inline-artifact-card-header">
      <span className="inline-artifact-badge">内容大纲</span>
      <span className="inline-artifact-title">内容大纲预览</span>
    </div>

    <ol className="outline-card-list">
      {items.map((item, index) => (
        <li key={item.id} className="outline-card-item">
          <div className="outline-card-item-title">
            <span className="outline-card-index">{index + 1}</span>
            <span>{item.title}</span>
            {item.pages > 1 && (
              <span className="outline-card-pages">约 {item.pages} 页</span>
            )}
          </div>
          {item.points.length > 0 && (
            <ul className="outline-card-points">
              {item.points.slice(0, 4).map((point, pointIndex) => (
                <li key={pointIndex}>{point}</li>
              ))}
              {item.points.length > 4 && (
                <li className="outline-card-more">… 还有 {item.points.length - 4} 个要点</li>
              )}
            </ul>
          )}
        </li>
      ))}
    </ol>

    {!resolved && (onConfirm || onRevise) && (
      <div className="inline-artifact-actions">
        {onRevise && (
          <button
            type="button"
            disabled={busy}
            className="btn-reject"
            onClick={onRevise}
          >
            继续修改
          </button>
        )}
        {onConfirm && (
          <button
            type="button"
            disabled={busy}
            className="btn-apply"
            onClick={onConfirm}
          >
            确认大纲
          </button>
        )}
      </div>
    )}
  </div>
);
