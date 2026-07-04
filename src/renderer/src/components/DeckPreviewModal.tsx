import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Presentation } from "@shared/presentation";
import { resolveSlideBackgroundWithVariant } from "@shared/slide-variant";
import { SlideElementRenderer } from "./SlideElementRenderer";
import { CompressIcon } from "./Icons";

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

function getThemeStyles(theme: string, palette: string) {
  let slideBg = "#fff";
  let titleColor = "#1e293b";
  let bodyColor = "#475569";
  let accentColor = "#0ea5e9";

  switch (theme) {
    case "nordic":
      slideBg = "#fbfbfa";
      titleColor = "#0f172a";
      bodyColor = "#334155";
      break;
    case "midnight":
      slideBg = "#0e1115";
      titleColor = "#f8fafc";
      bodyColor = "#94a3b8";
      break;
    case "ocean":
      slideBg = "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)";
      titleColor = "#f8fafc";
      bodyColor = "#cbd5e1";
      break;
    case "sunset":
      slideBg = "linear-gradient(135deg, #fffcf4 0%, #fff3e3 100%)";
      titleColor = "#3c2a21";
      bodyColor = "#776b5d";
      break;
    case "purple":
      slideBg = "radial-gradient(circle at top, #1c1537 0%, #0d091a 100%)";
      titleColor = "#f8fafc";
      bodyColor = "#b4befe";
      break;
  }

  switch (palette) {
    case "green":
      accentColor = "#10b981";
      break;
    case "purple":
      accentColor = "#a855f7";
      break;
    case "orange":
      accentColor = "#f97316";
      break;
    default:
      accentColor = "#0ea5e9";
  }

  return { slideBg, titleColor, bodyColor, accentColor };
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

  const themeStyles = getThemeStyles(selectedTheme, selectedPalette);
  const activeIndex = Math.max(
    0,
    presentation.slides.findIndex((slide) => slide.id === selectedSlideId),
  );
  const activeSlide = presentation.slides[activeIndex] ?? presentation.slides[0];
  const activeSlideBg = activeSlide
    ? resolveSlideBackgroundWithVariant(selectedTheme, selectedPalette, activeSlide).slideBg
    : themeStyles.slideBg;

  return createPortal(
    <div className="deck-preview-modal-overlay" onClick={onClose}>
      <div className="deck-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="deck-preview-modal-header">
          <div>
            <h3>{presentation.title || "演示文稿预览"}</h3>
            <p>只读预览 · 共 {presentation.slides.length} 页</p>
          </div>
          <button type="button" className="action-icon-btn" onClick={onClose} title="关闭预览">
            <CompressIcon size={16} />
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
                  background: activeSlideBg,
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
                      color: themeStyles.titleColor,
                      borderBottom: `2px solid ${themeStyles.accentColor}`,
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
                      bodyColor={themeStyles.bodyColor}
                      accentColor={themeStyles.accentColor}
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
