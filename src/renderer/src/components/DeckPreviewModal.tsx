import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Presentation } from "@shared/presentation";
import { resolveSlideDesignSystem } from "@shared/resolved-design-system";
import { resolveChromeTitleFontSize } from "@shared/slide-chrome";
import { SlideElementRenderer } from "./SlideElementRenderer";
import { ClosePreviewIcon } from "./Icons";

interface DeckPreviewModalProps {
  open: boolean;
  presentation: Presentation;
  selectedSlideId: string;
  selectedTheme: string;
  selectedPalette: string;
  logoUrl: string | null;
  onSelectSlide: (slideId: string) => void;
  onClose: () => void;
}

export const DeckPreviewModal: React.FC<DeckPreviewModalProps> = ({
  open,
  presentation,
  selectedSlideId,
  selectedTheme,
  selectedPalette,
  logoUrl,
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
  const designSystem = activeSlide
    ? resolveSlideDesignSystem(
        {
          theme: selectedTheme,
          palette: selectedPalette,
          designTokens: presentation.designTokens,
        },
        activeSlide,
      )
    : undefined;

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
              <div
                className="deck-preview-modal-slide"
                style={{
                  background: designSystem?.background.slideBg,
                  fontFamily: designSystem?.fontCss,
                }}
              >
                {logoUrl && (
                  <div className="slide-brand-logo">
                    <img src={logoUrl} alt="Logo" />
                  </div>
                )}

                {activeSlide.layout !== "cover" && activeSlide.layout !== "section" && (
                  <div
                    className="slide-header-text"
                    style={{
                      color: designSystem?.colors.title,
                      borderBottom: `2px solid ${designSystem?.colors.accent}`,
                      fontSize: resolveChromeTitleFontSize(activeSlide.title),
                    }}
                  >
                    {activeSlide.title}
                  </div>
                )}

                {activeSlide.elements.map((element) => (
                  <div
                    key={element.id}
                    style={{
                      position: "absolute",
                      left: element.x,
                      top: element.y,
                      width: element.width,
                      height: element.height,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <SlideElementRenderer
                      element={element}
                      theme={selectedTheme}
                      bodyColor={designSystem?.colors.body}
                      accentColor={designSystem?.colors.accent}
                      cardBg={designSystem?.colors.cardBg}
                      cardStroke={designSystem?.colors.cardStroke}
                      fontFamily={designSystem?.fontFamily}
                      imageTreatment={designSystem?.imageTreatment}
                      chartStyle={designSystem?.chartStyle}
                    />
                  </div>
                ))}
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
