import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Presentation, Slide } from "@shared/presentation";
import { utf8ToBase64 } from "@shared/base64";
import { ClosePreviewIcon } from "./Icons";

interface DeckPreviewModalProps {
  open: boolean;
  presentation: Presentation;
  selectedSlideId: string;
  logoUrl: string | null;
  onSelectSlide: (slideId: string) => void;
  onClose: () => void;
}

function NonSvgSlidePlaceholder({ slide }: { slide: Slide }) {
  return (
    <div className="slide-non-svg-placeholder">
      <span>{slide.title}</span>
      <small>此页非 SVG 原生，无法预览</small>
    </div>
  );
}

export const DeckPreviewModal: React.FC<DeckPreviewModalProps> = ({
  open,
  presentation,
  selectedSlideId,
  onSelectSlide,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const activeIndex = Math.max(
    0,
    presentation.slides.findIndex((slide) => slide.id === selectedSlideId),
  );
  const activeSlide = presentation.slides[activeIndex] ?? presentation.slides[0];

  return createPortal(
    <div className="deck-preview-modal-overlay" onClick={onClose}>
      <div className="deck-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="deck-preview-modal-header">
          <div>
            <h3>{presentation.title || "演示文稿预览"}</h3>
            <p>只读预览 · 共 {presentation.slides.length} 页</p>
          </div>
          <button type="button" className="action-icon-btn" onClick={onClose} title="关闭预览">
            <ClosePreviewIcon size={16} />
          </button>
        </div>

        <div className="deck-preview-modal-body">
          <aside className="deck-preview-modal-sidebar">
            {presentation.slides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                className={`deck-preview-modal-thumb ${slide.id === activeSlide?.id ? "active" : ""}`}
                onClick={() => onSelectSlide(slide.id)}
              >
                <span>{index + 1}</span>
                <strong>{slide.title}</strong>
              </button>
            ))}
          </aside>

          <div className="deck-preview-modal-canvas">
            {activeSlide ? (
              <div className="deck-preview-modal-slide">
                {activeSlide.visualSource?.kind === "svg" ? (
                  <img
                    src={`data:image/svg+xml;base64,${utf8ToBase64(activeSlide.visualSource.markup)}`}
                    alt={activeSlide.title}
                    style={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      objectFit: "fill",
                    }}
                  />
                ) : (
                  <NonSvgSlidePlaceholder slide={activeSlide} />
                )}
              </div>
            ) : (
              <div className="deck-preview-modal-empty">暂无幻灯片内容</div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
