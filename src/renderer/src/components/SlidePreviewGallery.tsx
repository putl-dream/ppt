import React, { useEffect, useState } from "react";
import type { DisplayEvent } from "@shared/card-display-protocol";

type SlidePreviewEvent = Extract<DisplayEvent, { kind: "artifact.slide-preview" }>;

interface SlidePreviewGalleryProps {
  previews: SlidePreviewEvent[];
}

export const SlidePreviewGallery: React.FC<SlidePreviewGalleryProps> = ({ previews }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex === null ? undefined : previews[selectedIndex];

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowLeft") {
        setSelectedIndex((index) => index === null ? null : Math.max(0, index - 1));
      }
      if (event.key === "ArrowRight") {
        setSelectedIndex((index) =>
          index === null ? null : Math.min(previews.length - 1, index + 1)
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previews.length, selected]);

  if (previews.length === 0) return null;

  return (
    <>
      <section className="inline-artifact-card slide-preview-gallery">
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
                className="slide-preview-gallery-item"
                key={event.eventId}
                onClick={() => thumbnail && setSelectedIndex(index)}
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

      {selected?.payload.thumbnail && (
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
              <span>{(selectedIndex ?? 0) + 1} / {previews.length}</span>
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
        </div>
      )}
    </>
  );
};
