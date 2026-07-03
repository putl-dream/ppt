import React, { useState } from "react";
import type { LayoutVisualMode } from "@shared/layout-preference";
import { LAYOUT_THEME_OPTIONS, loadLayoutVisualMode } from "@shared/layout-preference";
import type { InlineCardRef } from "@shared/inline-artifact-cards";

interface LayoutChoiceCardProps {
  slideCount: number;
  resolved?: InlineCardRef["resolved"];
  layoutMode?: LayoutVisualMode;
  selectedTheme: string;
  selectedPalette: string;
  onConfirm?: (mode: LayoutVisualMode, theme: string, palette: string) => void;
}

export const LayoutChoiceCard: React.FC<LayoutChoiceCardProps> = ({
  slideCount,
  resolved,
  layoutMode,
  selectedTheme,
  selectedPalette,
  onConfirm,
}) => {
  const [mode, setMode] = useState<LayoutVisualMode>(layoutMode ?? loadLayoutVisualMode());
  const [theme, setTheme] = useState(selectedTheme);
  const [palette, setPalette] = useState(selectedPalette);

  const handleThemePick = (nextTheme: string, nextPalette: string) => {
    setTheme(nextTheme);
    setPalette(nextPalette);
  };

  const resolvedLabel = resolved === "confirmed"
    ? (layoutMode === "creative" ? "已选：创意装饰" : "已选：标准排版")
    : undefined;

  return (
    <div className="inline-artifact-card layout-choice-card">
      <div className="inline-artifact-card-header">
        <span className="inline-artifact-badge">LAYOUT</span>
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
            name="layout-mode"
            value="template"
            checked={mode === "template"}
            disabled={Boolean(resolved)}
            onChange={() => setMode("template")}
          />
          <div className="layout-choice-option-body">
            <strong>标准排版</strong>
            <span>主题 + 布局模板，卡片与间距自动对齐（推荐）</span>
          </div>
        </label>

        <label className={`layout-choice-option${mode === "creative" ? " is-selected" : ""}`}>
          <input
            type="radio"
            name="layout-mode"
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
          <span className="layout-choice-themes-label">主题预览</span>
          <div className="layout-choice-theme-grid">
            {LAYOUT_THEME_OPTIONS.map((option) => (
              <button
                key={`${option.theme}-${option.palette}`}
                type="button"
                className={`layout-choice-theme-chip${
                  theme === option.theme && palette === option.palette ? " is-active" : ""
                }`}
                data-theme={option.theme}
                data-palette={option.palette}
                onClick={() => handleThemePick(option.theme, option.palette)}
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
            onClick={() => onConfirm(mode, theme, palette)}
          >
            确认并排版
          </button>
        </div>
      )}
    </div>
  );
};
