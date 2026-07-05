import React from "react";
import type { Presentation } from "@shared/presentation";
import { DownloadIcon, OpenPreviewIcon } from "./Icons";

interface DeckPreviewCardProps {
  presentation: Presentation;
  selectedTheme: string;
  selectedPalette: string;
  isExporting?: boolean;
  resolved?: "confirmed" | "dismissed";
  onPreview?: () => void;
  onExport?: () => void;
}

function getThemeSlideBg(theme: string): string {
  switch (theme) {
    case "midnight":
      return "#0e1115";
    case "ocean":
      return "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)";
    case "sunset":
      return "linear-gradient(135deg, #fffcf4 0%, #fff3e3 100%)";
    case "purple":
      return "radial-gradient(circle at top, #1c1537 0%, #0d091a 100%)";
    case "nordic":
      return "#fbfbfa";
    default:
      return "#ffffff";
  }
}

export const DeckPreviewCard: React.FC<DeckPreviewCardProps> = ({
  presentation,
  selectedTheme,
  selectedPalette,
  isExporting,
  resolved,
  onPreview,
  onExport,
}) => {
  const previewSlides = presentation.slides.slice(0, 6);
  const slideBg = getThemeSlideBg(selectedTheme);

  return (
    <div className="inline-artifact-card deck-preview-card">
      <div className="inline-artifact-card-header">
        <span className="inline-artifact-badge">DECK</span>
        <span className="inline-artifact-title">{presentation.title || "演示文稿"}</span>
        <span className="deck-preview-count">
          {presentation.slides.length} 页
          {resolved === "confirmed" && " · 已导出"}
        </span>
      </div>

      <div className="deck-preview-thumbnails">
        {previewSlides.map((slide, index) => (
          <div key={slide.id} className="deck-preview-thumb" title={slide.title}>
            <div
              className="deck-preview-thumb-inner"
              style={{ background: slideBg }}
            >
              <span className="deck-preview-thumb-index">{index + 1}</span>
              <span className="deck-preview-thumb-title">{slide.title}</span>
            </div>
          </div>
        ))}
        {presentation.slides.length > previewSlides.length && (
          <div className="deck-preview-thumb deck-preview-thumb-more">
            +{presentation.slides.length - previewSlides.length}
          </div>
        )}
      </div>

      <div className="inline-artifact-actions">
        {onPreview && (
          <button type="button" className="btn-reject" onClick={onPreview}>
            <OpenPreviewIcon size={13} />
            <span>预览 PPT</span>
          </button>
        )}
        {onExport && (
          <button
            type="button"
            className="btn-apply"
            disabled={isExporting}
            onClick={onExport}
          >
            <DownloadIcon size={13} />
            <span>{isExporting ? "导出中…" : "导出 PPT"}</span>
          </button>
        )}
      </div>
    </div>
  );
};
