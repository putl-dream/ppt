import React, { useId, useState } from "react";
import type { DesignPlanCandidate } from "@shared/design-plan";
import {
  confirmDesignPlan,
  type LayoutChoice,
} from "@shared/layout-preference";
import { ResolvedCard } from "./ResolvedCard";

interface LayoutChoiceCardProps {
  slideCount: number;
  candidate: DesignPlanCandidate;
  resolvedChoice?: LayoutChoice;
  onConfirm?: (choice: LayoutChoice) => void;
}

export const LayoutChoiceCard: React.FC<LayoutChoiceCardProps> = ({
  slideCount,
  candidate,
  resolvedChoice,
  onConfirm,
}) => {
  const radioGroupName = `design-direction-${useId()}`;
  const [selectedDirectionId, setSelectedDirectionId] = useState(
    resolvedChoice?.selectedDirectionId ?? candidate.recommendedDirectionId,
  );
  const selected = candidate.directions.find(
    (direction) => direction.id === selectedDirectionId,
  ) ?? candidate.directions[0];
  const resolvedDirection = resolvedChoice?.directions.find(
    (direction) => direction.id === resolvedChoice.selectedDirectionId,
  );

  if (resolvedChoice && resolvedDirection) {
    return (
      <ResolvedCard
        label="设计方向"
        title="已确认"
        detail={`${resolvedDirection.label} · ${resolvedDirection.designSystem.visualStyle}`}
      />
    );
  }

  return (
    <div className="inline-artifact-card layout-choice-card">
      <div className="inline-artifact-card-header">
        <span className="inline-artifact-badge">设计方向</span>
        <span className="inline-artifact-title">选择整套演示的视觉主张</span>
      </div>

      <p className="layout-choice-summary">
        内容草稿已就绪（{slideCount} 页待设计）。论证与阅读模式已锁定，请选择视觉距离。
      </p>

      <div className="layout-choice-options">
        {candidate.directions.map((direction) => {
          const isSelected = direction.id === selectedDirectionId;
          const isRecommended = direction.id === candidate.recommendedDirectionId;
          return (
            <label
              key={direction.id}
              className={`layout-choice-option${isSelected ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name={radioGroupName}
                value={direction.id}
                checked={isSelected}
                onChange={() => setSelectedDirectionId(direction.id)}
              />
              <div className="layout-choice-option-body">
                <strong>
                  {direction.label}
                  {isRecommended ? "（推荐）" : ""}
                </strong>
                <span>{direction.rationale}</span>
                <span>
                  {direction.designSystem.argumentMode}
                  {" · "}
                  {direction.designSystem.visualStyle}
                  {" · "}
                  {direction.designSystem.readingMode}
                </span>
              </div>
            </label>
          );
        })}
      </div>

      {onConfirm && selected && (
        <div className="inline-artifact-actions">
          <button
            type="button"
            className="btn-apply"
            onClick={() => onConfirm(confirmDesignPlan(candidate, selected.id))}
          >
            确认方向并开始设计
          </button>
        </div>
      )}
    </div>
  );
};
