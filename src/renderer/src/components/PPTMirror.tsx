import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Presentation } from "@shared/presentation";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import { resolveChromeTitleFontSize, resolveSlideStyle } from "@design-system";
import { SlideElementRenderer } from "./SlideElementRenderer";
import { ClosePreviewIcon, PlayIcon, DownloadIcon, ExpandIcon, CompressIcon } from "./Icons";


interface PPTMirrorProps {
  presentation: Presentation;
  selectedSlideId: string;
  onSelectSlide: (slideId: string) => void;
  themeMode: "light" | "dark";
  logoUrl: string | null;
  onCloseMirror: () => void;
  highlightSlideId: string | null; // AI 当前正在更新的页面 ID
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  triggerToast?: (msg: string) => void;
}

export const PPTMirror: React.FC<PPTMirrorProps> = ({
  presentation,
  selectedSlideId,
  onSelectSlide,
  themeMode,
  logoUrl,
  onCloseMirror,
  highlightSlideId,
  isExpanded = false,
  onToggleExpand,
  triggerToast,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleDownload = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const savedPath = await window.desktopApi.exportPresentation(presentation, {
        logoUrl: logoUrl,
      });
      if (savedPath) {
        triggerToast?.(`🎉 成功导出至: ${savedPath}`);
      }
    } catch (error) {
      console.error(error);
      triggerToast?.(`导出失败：${formatPublicErrorMessage(error, "请稍后重试。")}`);
    } finally {
      setIsExporting(false);
    }
  };

  const slides = presentation.slides;

  // 当外部选中/高亮变化时，平滑滚动至可视区域
  useEffect(() => {
    const targetId = highlightSlideId || selectedSlideId;
    if (targetId && cardRefs.current[targetId]) {
      cardRefs.current[targetId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedSlideId, highlightSlideId]);

  // 监听全屏放映时的键盘事件
  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "Space" || e.key === " ") {
        e.preventDefault();
        setFullscreenIndex((prev) => Math.min(slides.length - 1, prev + 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setFullscreenIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen, slides.length]);

  // 当全屏放映的页面改变时，同步选中状态到主工作区
  useEffect(() => {
    if (isFullscreen && slides[fullscreenIndex]) {
      onSelectSlide(slides[fullscreenIndex].id);
    }
  }, [fullscreenIndex, isFullscreen]);

  const fullscreenSlide = slides[fullscreenIndex];
  const fullscreenSystem = fullscreenSlide
    ? resolveSlideStyle(presentation.designSystem, fullscreenSlide)
    : undefined;

  const handleFullscreenOpen = () => {
    const idx = slides.findIndex((s) => s.id === selectedSlideId);
    setFullscreenIndex(idx >= 0 ? idx : 0);
    setIsFullscreen(true);
  };

  return (
    <aside className="right-panel mirror-panel">
      {/* 顶部工具栏 */}
      <div className="panel-header right-header mirror-header">
        <div className="mirror-header-actions">
          <button
            onClick={handleFullscreenOpen}
            className="action-icon-btn mirror-header-icon-btn"
            aria-label="放映演示文稿"
            title="放映演示文稿"
          >
            <PlayIcon size={16} />
          </button>
          <button
            onClick={handleDownload}
            className="action-icon-btn mirror-header-icon-btn"
            disabled={isExporting}
            aria-label="下载 PPT"
            title="下载 PPT"
          >
            <DownloadIcon size={16} />
          </button>
          <button
            onClick={onToggleExpand}
            className="action-icon-btn mirror-header-icon-btn mirror-expand-toggle-btn"
            aria-label={isExpanded ? "收缩预览" : "放大预览"}
            title={isExpanded ? "收缩预览" : "放大预览"}
          >
            {isExpanded ? <CompressIcon size={16} /> : <ExpandIcon size={16} />}
          </button>
          <button
            onClick={onCloseMirror}
            className="action-icon-btn mirror-header-icon-btn mirror-panel-close-btn"
            aria-label="关闭右侧预览"
            title="关闭右侧预览"
          >
            <ClosePreviewIcon size={16} />
          </button>
        </div>
      </div>

      {/* 纵向滚动卡片列表 */}
      <div
        className="sections-container flex-1 overflow-y-auto"
        ref={scrollContainerRef}
        style={{
          padding: isExpanded ? "30px 40px" : "20px 14px",
          display: "flex",
          flexDirection: isExpanded ? "row" : "column",
          flexWrap: isExpanded ? "wrap" : "nowrap",
          gap: isExpanded ? 30 : 20,
          justifyContent: isExpanded ? "center" : "flex-start",
          alignContent: "flex-start"
        }}
      >
        {slides.map((slide, index) => {
          const isSelected = selectedSlideId === slide.id;
          const isHighlighted = highlightSlideId === slide.id;
          const cardWidth = isExpanded ? 320 : 280;
          const cardHeight = isExpanded ? 180 : 157.5;
          const scale = cardWidth / 1280;

          const slideStyle = resolveSlideStyle(presentation.designSystem, slide);

          return (
            <div
              key={slide.id}
              ref={(el) => {
                cardRefs.current[slide.id] = el;
              }}
              className={`mirror-slide-card-container ${
                isSelected ? "selected" : ""
              } ${isHighlighted ? "highlighted-pulse" : ""}`}
              onClick={() => onSelectSlide(slide.id)}
              style={{ width: cardWidth }}
            >
              {/* 页码与选中标签 */}
              <div className="mirror-card-meta">
                <span className="slide-number">{(index + 1).toString().padStart(2, "0")}</span>
                {isSelected && <span className="selected-tag">已选中</span>}
              </div>

              {/* 等比例缩放的幻灯片镜像 */}
              <div
                className="mirror-slide-wrapper"
                style={{
                  width: cardWidth,
                  height: cardHeight,
                  overflow: "hidden",
                  position: "relative",
                  borderRadius: 6,
                  border: "1px solid rgba(15, 23, 42, 0.12)",
                  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
                }}
              >
                <div
                  className="slide-viewport"
                  style={{
                    width: 1280,
                    height: 720,
                    background: slideStyle.background.css,
                    fontFamily: slideStyle.typography.css,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    border: `1px solid ${slideStyle.colors.cardStroke}`,
                  }}
                >
                  {/* Logo */}
                  {logoUrl && (
                    <div className="slide-brand-logo">
                      <img src={logoUrl} alt="Logo" />
                    </div>
                  )}

                  {/* 页码 */}
                  <div className="slide-page-number" style={{ color: slideStyle.colors.body }}>
                    {index + 1}
                  </div>

                  {/* 标题 */}
                  {slide.layout !== "cover" && slide.layout !== "section" && (
                    <div
                      className="slide-header-text"
                      style={{
                        color: slideStyle.colors.title,
                        borderBottom: `2px solid ${slideStyle.colors.accent}`,
                        fontSize: resolveChromeTitleFontSize(slide.title),
                      }}
                    >
                      {slide.title}
                    </div>
                  )}

                  {/* 元素 */}
                  {slide.elements.map((element) => (
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
                        style={slideStyle}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        {slides.length === 0 && (
          <div className="mirror-empty-state">
            <p className="mirror-empty-title">还没有幻灯片</p>
            <p className="mirror-empty-hint">在下方对话框描述你的需求，AI 会帮你生成第一页。</p>
          </div>
        )}
      </div>

      {/* 4. 全屏放映灯箱模态窗口 */}
      {isFullscreen && createPortal(
        <div
          className={`slideshow-lightbox-overlay ${themeMode === "dark" ? "dark-theme" : ""}`}
          onClick={() => setIsFullscreen(false)}
        >
          <div className="slideshow-lightbox-content" onClick={(e) => e.stopPropagation()}>
            {/* 顶栏控制 */}
            <div className="slideshow-top-bar">
              <span className="slideshow-title">{presentation.title}</span>
              <span className="slideshow-progress">
                第 {fullscreenIndex + 1} 页 / 共 {slides.length} 页
              </span>
              <button
                className="slideshow-close"
                onClick={() => setIsFullscreen(false)}
              >
                ✕ 关闭放映
              </button>
            </div>

            {/* 主幻灯片预览区 */}
            <div
              className="slideshow-viewport-container"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                if (clickX > rect.width / 2) {
                  setFullscreenIndex((prev) => Math.min(slides.length - 1, prev + 1));
                } else {
                  setFullscreenIndex((prev) => Math.max(0, prev - 1));
                }
              }}
              style={{ cursor: "pointer" }}
            >
              {slides[fullscreenIndex] ? (
                <div
                  className="slide-viewport"
                  style={{
                    width: 1280,
                    height: 720,
                    background: fullscreenSystem?.background.css,
                    fontFamily: fullscreenSystem?.typography.css,
                    boxShadow: "var(--slideshow-slide-shadow)",
                    borderRadius: 8,
                    position: "relative",
                    transform: `scale(${Math.min(window.innerWidth / 1380, window.innerHeight / 820)})`,
                    transformOrigin: "center center",
                    border: fullscreenSystem
                      ? `1px solid ${fullscreenSystem.colors.cardStroke}`
                      : undefined,
                  }}
                >
                  {/* Logo */}
                  {logoUrl && (
                    <div className="slide-brand-logo">
                      <img src={logoUrl} alt="Logo" />
                    </div>
                  )}

                  {/* 页码 */}
                  <div className="slide-page-number" style={{ color: fullscreenSystem?.colors.body }}>
                    {fullscreenIndex + 1}
                  </div>

                  {/* 标题 */}
                  {slides[fullscreenIndex].layout !== "cover" && slides[fullscreenIndex].layout !== "section" && (
                    <div
                      className="slide-header-text"
                      style={{
                        color: fullscreenSystem?.colors.title,
                        borderBottom: `2px solid ${fullscreenSystem?.colors.accent}`,
                        fontSize: resolveChromeTitleFontSize(slides[fullscreenIndex].title),
                      }}
                    >
                      {slides[fullscreenIndex].title}
                    </div>
                  )}

                  {/* 元素 */}
                  {slides[fullscreenIndex].elements.map((element) => (
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
                        style={fullscreenSystem!}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-white">无页面</div>
              )}
            </div>

            {/* 左右翻页控制器 */}
            <button
              className="slideshow-nav-arrow left"
              disabled={fullscreenIndex === 0}
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenIndex((i) => Math.max(0, i - 1));
              }}
            >
              ‹
            </button>
            <button
              className="slideshow-nav-arrow right"
              disabled={fullscreenIndex === slides.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                setFullscreenIndex((i) => Math.min(slides.length - 1, i + 1));
              }}
            >
              ›
            </button>
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
};
