import React, { useId, useState } from "react";
import type { LayoutVisualMode } from "@shared/layout-preference";
import { LAYOUT_DESIGN_OPTIONS, loadLayoutVisualMode } from "@shared/layout-preference";
import type { DesignSystemV1 } from "@design-system";

interface LayoutChoiceCardProps {
  slideCount: number;
  resolved?: "confirmed" | "dismissed";
  layoutMode?: LayoutVisualMode;
  selectedDesignSystem: DesignSystemV1;
  onConfirm?: (mode: LayoutVisualMode, designSystem: DesignSystemV1) => void;
}

export const LayoutChoiceCard: React.FC<LayoutChoiceCardProps> = ({
  slideCount,
  resolved,
  layoutMode,
  selectedDesignSystem,
  onConfirm,
}) => {
  const radioGroupName = `layout-mode-${useId()}`;
  const [mode, setMode] = useState<LayoutVisualMode>(layoutMode ?? loadLayoutVisualMode());
  const [designSystem, setDesignSystem] = useState(selectedDesignSystem);

  const resolvedLabel = resolved === "confirmed"
    ? (layoutMode === "creative" ? "已选：创意装饰" : "已选：标准排版")
    : undefined;

  return (
    <div className="inline-artifact-card layout-choice-card">
      <div className="inline-artifact-card-header">
        <span className="inline-artifact-badge">版式选择</span>
        <span className="inline-artifact-title">选择视觉排版方式</span>
        {resolvedLabel && (
          <span className="inline-artifact-resolved">{resolvedLabel}</span>
        )}
      </div>

      <p className="layout-choice-summary">
        内容草稿已就绪（{slideCount} 页待排版）。请选择视觉呈现方式后继续。
      </p>

      <div className="layout-choice-options">
        <label className={`layout-choice-option${mode === "template" ? " is-selected" : ""}`}>
          <input
            type="radio"
            name={radioGroupName}
            value="template"
            checked={mode === "template"}
            disabled={Boolean(resolved)}
            onChange={() => setMode("template")}
          />
          <div className="layout-choice-option-body">
            <strong>标准排版</strong>
            <span>设计系统 + 布局语法，视觉与间距自动对齐（推荐）</span>
          </div>
        </label>

        <label className={`layout-choice-option${mode === "creative" ? " is-selected" : ""}`}>
          <input
            type="radio"
            name={radioGroupName}
            value="creative"
            checked={mode === "creative"}
            disabled={Boolean(resolved)}
            onChange={() => setMode("creative")}
          />
          <div className="layout-choice-option-body">
            <strong>创意装饰</strong>
            <span>在标准排版基础上添加箭头、线条、序号等图形元素</span>
          </div>
        </label>
      </div>

      {mode === "template" && !resolved && (
        <div className="layout-choice-themes">
          <span className="layout-choice-themes-label">设计系统预览</span>
          <div className="layout-choice-theme-grid">
            {LAYOUT_DESIGN_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`layout-choice-theme-chip${
                  designSystem.tokens.palette === option.system.tokens.palette ? " is-active" : ""
                }`}
                data-palette={option.system.tokens.palette}
                onClick={() => setDesignSystem(option.system)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!resolved && onConfirm && (
        <div className="inline-artifact-actions">
          <button
            type="button"
            className="btn-apply"
            onClick={() => onConfirm(mode, designSystem)}
          >
            确认并排版
          </button>
        </div>
      )}
    </div>
  );
};
