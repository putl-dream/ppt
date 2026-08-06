import { utf8ToBase64 } from "@shared/base64";
import type { Presentation } from "@shared/presentation";
import type React from "react";
import { DownloadIcon, OpenPreviewIcon } from "./Icons";

interface DeckPreviewCardProps {
  presentation: Presentation;
  isExporting?: boolean;
  resolved?: "confirmed" | "dismissed";
  onPreview?: () => void;
  onExport?: () => void;
}

export const DeckPreviewCard: React.FC<DeckPreviewCardProps> = ({
  presentation,
  isExporting,
  resolved,
  onPreview,
  onExport,
}) => {
  const previewSlides = presentation.slides.slice(0, 6);

  return (
    <div className="inline-artifact-card deck-preview-card">
      <div className="inline-artifact-card-header">
        <span className="inline-artifact-badge">演示文稿</span>
        <span className="inline-artifact-title">{presentation.title || "演示文稿"}</span>
        <span className="deck-preview-count">
          {presentation.slides.length} 页{resolved === "confirmed" && " · 已导出"}
        </span>
      </div>

      <div className="deck-preview-thumbnails">
        {previewSlides.map((slide) => (
          <div key={slide.id} className="deck-preview-thumb" title={slide.title}>
            <div
              className={`deck-preview-thumb-inner ${
                slide.visualSource?.kind === "svg" ? "deck-preview-thumb-inner-svg" : ""
              }`}
              style={{ background: "#ffffff" }}
            >
              {slide.visualSource?.kind === "svg" ? (
                <img
                  src={`data:image/svg+xml;base64,${utf8ToBase64(slide.visualSource.markup)}`}
                  alt={slide.title}
                  style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }}
                />
              ) : (
                <span className="deck-preview-thumb-non-svg">非 SVG</span>
              )}
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
          <button type="button" className="btn-secondary" onClick={onPreview}>
            <OpenPreviewIcon size={13} />
            <span>预览 PPT</span>
          </button>
        )}
        {onExport && (
          <button type="button" className="btn-apply" disabled={isExporting} onClick={onExport}>
            <DownloadIcon size={13} />
            <span>{isExporting ? "导出中…" : "导出 PPT"}</span>
          </button>
        )}
      </div>
    </div>
  );
};
