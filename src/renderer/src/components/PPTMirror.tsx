import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Presentation, SlideElement } from "@shared/presentation";
import { SparklesIcon, ExpandIcon, CompressIcon, PlayIcon, FileIcon } from "./Icons";


interface PPTMirrorProps {
  presentation: Presentation;
  selectedSlideId: string;
  onSelectSlide: (slideId: string) => void;
  selectedTheme: string;
  selectedPalette: string;
  logoUrl: string | null;
  onOptimizePresentation: () => void;
  highlightSlideId: string | null; // AI 当前正在更新的页面 ID
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const PPTMirror: React.FC<PPTMirrorProps> = ({
  presentation,
  selectedSlideId,
  onSelectSlide,
  selectedTheme,
  selectedPalette,
  logoUrl,
  onOptimizePresentation,
  highlightSlideId,
  isExpanded = false,
  onToggleExpand,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  // 根据模板计算页面样式
  const getThemeStyles = () => {
    let slideBg = "#fff";
    let titleColor = "#1e293b";
    let bodyColor = "#475569";
    let fontClass = "font-sans";
    let borderStyle = {};
    let slideshowOverlayBg = "rgba(4, 5, 8, 0.93)";
    let isDarkOverlay = true;

    switch (selectedTheme) {
      case "nordic":
        slideBg = "#fbfbfa";
        titleColor = "#0f172a";
        bodyColor = "#334155";
        fontClass = "font-serif";
        borderStyle = { border: "1px solid rgba(15, 23, 42, 0.08)" };
        slideshowOverlayBg = "rgba(240, 242, 245, 0.96)";
        isDarkOverlay = false;
        break;
      case "midnight":
        slideBg = "#0e1115";
        titleColor = "#f8fafc";
        bodyColor = "#94a3b8";
        fontClass = "font-mono";
        borderStyle = { border: "1px solid rgba(255, 255, 255, 0.08)" };
        slideshowOverlayBg = "rgba(4, 5, 8, 0.95)";
        isDarkOverlay = true;
        break;
      case "ocean":
        slideBg = "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)";
        titleColor = "#f8fafc";
        bodyColor = "#cbd5e1";
        fontClass = "font-sans";
        borderStyle = { border: "1px solid rgba(14, 165, 233, 0.25)" };
        slideshowOverlayBg = "rgba(10, 15, 30, 0.95)";
        isDarkOverlay = true;
        break;
      case "sunset":
        slideBg = "linear-gradient(135deg, #fffcf4 0%, #fff3e3 100%)";
        titleColor = "#3c2a21";
        bodyColor = "#776b5d";
        fontClass = "font-serif";
        borderStyle = { border: "1px solid rgba(120, 80, 40, 0.15)" };
        slideshowOverlayBg = "rgba(252, 248, 242, 0.96)";
        isDarkOverlay = false;
        break;
      case "purple":
        slideBg = "radial-gradient(circle at top, #1c1537 0%, #0d091a 100%)";
        titleColor = "#f8fafc";
        bodyColor = "#b4befe";
        fontClass = "font-sans";
        borderStyle = { border: "1px solid rgba(168, 85, 247, 0.25)" };
        slideshowOverlayBg = "rgba(13, 9, 26, 0.95)";
        isDarkOverlay = true;
        break;
    }

    let accentColor = "#0ea5e9";
    switch (selectedPalette) {
      case "cyan":
        accentColor = "#0ea5e9";
        break;
      case "green":
        accentColor = "#10b981";
        break;
      case "purple":
        accentColor = "#a855f7";
        break;
      case "orange":
        accentColor = "#f97316";
        break;
    }

    return { slideBg, titleColor, bodyColor, fontClass, borderStyle, accentColor, slideshowOverlayBg, isDarkOverlay };
  };

  const themeStyles = getThemeStyles();

  const handleFullscreenOpen = () => {
    const idx = slides.findIndex((s) => s.id === selectedSlideId);
    setFullscreenIndex(idx >= 0 ? idx : 0);
    setIsFullscreen(true);
  };

  return (
    <aside className="right-panel mirror-panel">
      {/* 顶部工具栏 */}
      <div className="panel-header right-header">
        <div className="right-header-title">
          <FileIcon size={16} className="text-secondary" />
          <span>PPT 实时预览</span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={onOptimizePresentation}
            className="optimize-slide-btn"
            style={{ padding: "6px 10px", fontSize: 11, display: "flex", alignItems: "center", gap: "4px", margin: 0 }}
            title="AI 重新排版润色全体幻灯片"
          >
            <SparklesIcon size={12} />
            <span>AI美化</span>
          </button>
          <button
            onClick={handleFullscreenOpen}
            className="action-icon-btn"
            style={{ padding: 6, margin: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
            title="放映演示文稿"
          >
            <PlayIcon size={14} />
          </button>
          <button
            onClick={onToggleExpand}
            className="action-icon-btn"
            style={{ padding: 6, margin: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
            title={isExpanded ? "收缩预览" : "放大预览"}
          >
            {isExpanded ? <CompressIcon size={14} /> : <ExpandIcon size={14} />}
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
                  border: "1px solid var(--border-glass)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              >
                <div
                  className={`slide-viewport ${themeStyles.fontClass}`}
                  style={{
                    width: 1280,
                    height: 720,
                    background: themeStyles.slideBg,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    ...themeStyles.borderStyle,
                  }}
                >
                  {/* Logo */}
                  {logoUrl && (
                    <div className="slide-brand-logo">
                      <img src={logoUrl} alt="Logo" />
                    </div>
                  )}

                  {/* 页码 */}
                  <div className="slide-page-number" style={{ color: themeStyles.bodyColor }}>
                    {index + 1}
                  </div>

                  {/* 标题 */}
                  <div
                    className="slide-header-text"
                    style={{
                      color: themeStyles.titleColor,
                      borderBottom: `2px solid ${themeStyles.accentColor}`,
                    }}
                  >
                    {slide.title}
                  </div>

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
                      {element.type === "text" && (
                        <p
                          style={{
                            fontSize: element.fontSize,
                            color: themeStyles.bodyColor,
                            margin: 0,
                            lineHeight: 1.4,
                          }}
                        >
                          {element.text}
                        </p>
                      )}

                      {element.type === "image" && (
                        <img
                          src={element.url}
                          alt="image"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: `${element.borderRadius || 0}px`,
                          }}
                        />
                      )}

                      {element.type === "shape" && (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            backgroundColor: element.fillColor || "#3b82f6",
                            border: `2px solid ${element.strokeColor || "#1d4ed8"}`,
                            borderRadius: element.shapeType === "circle" ? "50%" : "0px",
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. 全屏放映灯箱模态窗口 */}
      {isFullscreen && createPortal(
        <div
          className="slideshow-lightbox-overlay"
          onClick={() => setIsFullscreen(false)}
          style={{ background: themeStyles.slideshowOverlayBg }}
        >
          <div className="slideshow-lightbox-content" onClick={(e) => e.stopPropagation()}>
            {/* 顶栏控制 */}
            <div
              className="slideshow-top-bar"
              style={{
                color: themeStyles.isDarkOverlay ? "#fff" : "#0f172a",
                borderBottom: themeStyles.isDarkOverlay ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(15, 23, 42, 0.08)",
                background: themeStyles.isDarkOverlay ? "rgba(0, 0, 0, 0.4)" : "rgba(255, 255, 255, 0.4)",
              }}
            >
              <span className="slideshow-title">{presentation.title}</span>
              <span
                className="slideshow-progress"
                style={{ color: themeStyles.isDarkOverlay ? "#94a3b8" : "#475569" }}
              >
                第 {fullscreenIndex + 1} 页 / 共 {slides.length} 页
              </span>
              <button
                className="slideshow-close"
                onClick={() => setIsFullscreen(false)}
                style={{
                  color: themeStyles.isDarkOverlay ? "#f8fafc" : "#0f172a",
                  background: themeStyles.isDarkOverlay ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.04)",
                  borderColor: themeStyles.isDarkOverlay ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.1)",
                }}
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
                  className={`slide-viewport ${themeStyles.fontClass}`}
                  style={{
                    width: 1280,
                    height: 720,
                    background: themeStyles.slideBg,
                    boxShadow: themeStyles.isDarkOverlay ? "0 25px 60px rgba(0,0,0,0.8)" : "0 25px 60px rgba(15,23,42,0.15)",
                    borderRadius: 8,
                    position: "relative",
                    transform: `scale(${Math.min(window.innerWidth / 1380, window.innerHeight / 820)})`,
                    transformOrigin: "center center",
                    ...themeStyles.borderStyle,
                  }}
                >
                  {/* Logo */}
                  {logoUrl && (
                    <div className="slide-brand-logo">
                      <img src={logoUrl} alt="Logo" />
                    </div>
                  )}

                  {/* 页码 */}
                  <div className="slide-page-number" style={{ color: themeStyles.bodyColor }}>
                    {fullscreenIndex + 1}
                  </div>

                  {/* 标题 */}
                  <div
                    className="slide-header-text"
                    style={{
                      color: themeStyles.titleColor,
                      borderBottom: `2px solid ${themeStyles.accentColor}`,
                    }}
                  >
                    {slides[fullscreenIndex].title}
                  </div>

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
                      {element.type === "text" && (
                        <p
                          style={{
                            fontSize: element.fontSize,
                            color: themeStyles.bodyColor,
                            margin: 0,
                            lineHeight: 1.4,
                          }}
                        >
                          {element.text}
                        </p>
                      )}

                      {element.type === "image" && (
                        <img
                          src={element.url}
                          alt="image"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: `${element.borderRadius || 0}px`,
                          }}
                        />
                      )}

                      {element.type === "shape" && (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            backgroundColor: element.fillColor || "#3b82f6",
                            border: `2px solid ${element.strokeColor || "#1d4ed8"}`,
                            borderRadius: element.shapeType === "circle" ? "50%" : "0px",
                          }}
                        />
                      )}
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
              style={{
                color: themeStyles.isDarkOverlay ? "#fff" : "#0f172a",
                background: themeStyles.isDarkOverlay ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.03)",
                borderColor: themeStyles.isDarkOverlay ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.06)",
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
              style={{
                color: themeStyles.isDarkOverlay ? "#fff" : "#0f172a",
                background: themeStyles.isDarkOverlay ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.03)",
                borderColor: themeStyles.isDarkOverlay ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.06)",
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
