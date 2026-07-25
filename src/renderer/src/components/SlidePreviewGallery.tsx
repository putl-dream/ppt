import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SlidePreviewEvent } from "../cards/select-slide-previews";

interface SlidePreviewGalleryProps {
  previews: SlidePreviewEvent[];
  selectedSlideId?: string;
  onSelectSlide?: (slideId: string) => void;
  variant?: "inline" | "panel";
}

export const SlidePreviewGallery: React.FC<SlidePreviewGalleryProps> = ({
  previews,
  selectedSlideId,
  onSelectSlide,
  variant = "inline",
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex === null ? undefined : previews[selectedIndex];

  const openPreview = useCallback((index: number) => {
    const preview = previews[index];
    if (!preview?.payload.thumbnail) return;
    setSelectedIndex(index);
    onSelectSlide?.(preview.payload.slideId);
  }, [onSelectSlide, previews]);

  const movePreview = useCallback((delta: number) => {
    if (selectedIndex === null) return;
    openPreview(Math.max(0, Math.min(previews.length - 1, selectedIndex + delta)));
  }, [openPreview, previews.length, selectedIndex]);

  useEffect(() => {
    if (selectedIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        movePreview(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        movePreview(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [movePreview, selectedIndex]);

  useEffect(() => {
    if (selectedIndex !== null && !previews[selectedIndex]) {
      setSelectedIndex(null);
    }
  }, [previews, selectedIndex]);

  if (previews.length === 0) return null;

  return (
    <>
      <section
        className={[
          "inline-artifact-card",
          "slide-preview-gallery",
          variant === "panel" ? "slide-preview-gallery--panel" : "",
        ].filter(Boolean).join(" ")}
        aria-label="页面检查预览"
      >
        <div className="inline-artifact-card-header">
          <span className="inline-artifact-badge">页面预览</span>
          <span className="inline-artifact-title">
            {previews.length === 1 ? previews[0]!.payload.title : `已检查 ${previews.length} 页`}
          </span>
          <span className="inline-artifact-resolved">点击查看大图</span>
        </div>
        <div className="slide-preview-gallery-grid">
          {previews.map((event, index) => {
            const { thumbnail } = event.payload;
            return (
              <button
                type="button"
                className={[
                  "slide-preview-gallery-item",
                  selectedSlideId === event.payload.slideId ? "is-current-slide" : "",
                ].filter(Boolean).join(" ")}
                key={event.eventId}
                onClick={() => openPreview(index)}
                disabled={!thumbnail}
                aria-label={thumbnail ? `查看 ${event.payload.title} 大图` : event.payload.title}
              >
                <span className="slide-preview-gallery-media">
                  {thumbnail ? (
                    <img
                      src={`data:${thumbnail.mimeType};base64,${thumbnail.pngBase64}`}
                      width={thumbnail.width}
                      height={thumbnail.height}
                      alt=""
                    />
                  ) : (
                    <span className="slide-preview-gallery-error">
                      {event.payload.thumbnailError ?? "当前环境不支持截图"}
                    </span>
                  )}
                </span>
                <span className="slide-preview-gallery-caption">
                  <b>{index + 1}</b>
                  <span>{event.payload.title}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selected?.payload.thumbnail && createPortal(
        <div
          className="slide-preview-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${selected.payload.title} 页面预览`}
          onClick={() => setSelectedIndex(null)}
        >
          <div className="slide-preview-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="slide-preview-lightbox-header">
              <span>{selected.payload.title}</span>
              <div className="slide-preview-lightbox-navigation">
                <button
                  type="button"
                  onClick={() => movePreview(-1)}
                  disabled={selectedIndex === 0}
                  aria-label="上一张检查预览"
                >
                  ‹
                </button>
                <span>{(selectedIndex ?? 0) + 1} / {previews.length}</span>
                <button
                  type="button"
                  onClick={() => movePreview(1)}
                  disabled={selectedIndex === previews.length - 1}
                  aria-label="下一张检查预览"
                >
                  ›
                </button>
              </div>
              <button type="button" onClick={() => setSelectedIndex(null)} aria-label="关闭预览">
                ×
              </button>
            </div>
            <img
              src={`data:${selected.payload.thumbnail.mimeType};base64,${selected.payload.thumbnail.pngBase64}`}
              width={selected.payload.thumbnail.width}
              height={selected.payload.thumbnail.height}
              alt={`${selected.payload.title} 页面预览`}
            />
            {selected.payload.description && (
              <p>{selected.payload.description}</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
