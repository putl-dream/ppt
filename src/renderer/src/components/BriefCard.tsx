import React from "react";
import type { BriefFields } from "@shared/project-artifacts";

interface BriefCardProps {
  fields: BriefFields;
  resolved?: "confirmed" | "dismissed";
  onConfirm?: () => void;
}

const FIELD_LABELS: Array<{ key: keyof BriefFields; label: string }> = [
  { key: "title", label: "项目名称" },
  { key: "purpose", label: "核心目的" },
  { key: "audience", label: "目标听众" },
  { key: "duration", label: "演讲时长" },
  { key: "style", label: "期望风格" },
];

export const BriefCard: React.FC<BriefCardProps> = ({
  fields,
  resolved,
  onConfirm,
}) => (
  <div className="inline-artifact-card brief-card">
    <div className="inline-artifact-card-header">
      <span className="inline-artifact-badge">需求简报</span>
      <span className="inline-artifact-title">需求简报摘要</span>
      {resolved === "confirmed" && (
        <span className="inline-artifact-resolved">已确认</span>
      )}
    </div>

    <dl className="brief-card-fields">
      {FIELD_LABELS.map(({ key, label }) => (
        <div key={key} className="brief-card-field">
          <dt>{label}</dt>
          <dd>{fields[key]}</dd>
        </div>
      ))}
    </dl>

    {!resolved && onConfirm && (
      <div className="inline-artifact-actions">
        <button type="button" className="btn-apply" onClick={onConfirm}>
          确认 Brief
        </button>
      </div>
    )}
  </div>
);
