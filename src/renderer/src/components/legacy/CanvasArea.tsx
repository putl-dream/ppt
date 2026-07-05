import React, { useRef, useState, useEffect } from "react";
import { Presentation, Slide, SlideElement, TextElement } from "@shared/presentation";
import { fontFamilyToCss, resolveElementFontFamily } from "@shared/typography";
import { resolveSlideBackgroundWithVariant } from "@shared/slide-variant";
import { ShapeElementView } from "../ShapeElementView";
import { SlideElementRenderer } from "../SlideElementRenderer";
import {
  UndoIcon,
  RedoIcon,
  SparklesIcon,
  OpenPreviewIcon,
  ClosePreviewIcon,
  PlusIcon,
  TrashIcon,
  DuplicateIcon,
  SunIcon,
  MoonIcon,
} from "../Icons";

interface CanvasAreaProps {
  presentation: Presentation;
  selectedSlideId: string;
  onSelectSlide: (slideId: string) => void;
  selectedElementId: string | null;
  onSelectElement: (elementId: string | null) => void;
  selectedTheme: string;
  selectedPalette: string;
  logoUrl: string | null;
  onUpdateElement: (slideId: string, elementId: string, element: SlideElement) => void;
  onUpdateElementPosition: (
    slideId: string,
    elementId: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) => void;
  onAddSlide: () => void;
  onDuplicateSlide: (slideId: string) => void;
  onDeleteSlide: (slideId: string) => void;
  onOptimizeSlide: (slideId: string) => void;
  onAddElement: (type: "text" | "image" | "shape") => void;
  isMirrorOpen: boolean;
  onToggleMirror: () => void;
  themeMode: "light" | "dark";
  onToggleThemeMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onProposePrompt: (prompt: string) => void;
}

export const CanvasArea: React.FC<CanvasAreaProps> = ({
  presentation,
  selectedSlideId,
  onSelectSlide,
  selectedElementId,
  onSelectElement,
  selectedTheme,
  selectedPalette,
  logoUrl,
  onUpdateElement,
  onUpdateElementPosition,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onOptimizeSlide,
  onAddElement,
  isMirrorOpen,
  onToggleMirror,
  themeMode,
  onToggleThemeMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onProposePrompt,
}) => {
  const slideContainerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [editingText, setEditingText] = useState<{ id: string; text: string } | null>(null);

  // 拖动和拉伸尺寸状态
  const [dragState, setDragState] = useState<{
    elementId: string;
    mode: "move" | "resize-se" | "resize-s" | "resize-e";
    startX: number;
    startY: number;
    startElemX: number;
    startElemY: number;
    startElemW: number;
    startElemH: number;
  } | null>(null);

  const slides = presentation.slides;
  const currentSlideIndex = slides.findIndex((s) => s.id === selectedSlideId);
  const activeSlideIndex = currentSlideIndex >= 0 ? currentSlideIndex : 0;
  const activeSlide = slides[activeSlideIndex] || slides[0];

  // 计算适配缩放比
  useEffect(() => {
    const updateScale = () => {
      if (slideContainerRef.current) {
        const containerWidth = slideContainerRef.current.clientWidth;
        const newScale = containerWidth / 1280;
        setScale(newScale);
      }
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    const timer = setTimeout(updateScale, 400);

    return () => {
      window.removeEventListener("resize", updateScale);
      clearTimeout(timer);
    };
  }, [isMirrorOpen, activeSlide]);

  const handleSlideSelect = (index: number) => {
    if (slides[index]) {
      onSelectSlide(slides[index].id);
      onSelectElement(null);
      setEditingText(null);
    }
  };

  // 鼠标点下开始拖拽
  const handleMouseDown = (
    e: React.MouseEvent,
    element: SlideElement,
    mode: "move" | "resize-se" | "resize-s" | "resize-e"
  ) => {
    e.stopPropagation();
    onSelectElement(element.id);
    
    setDragState({
      elementId: element.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startElemX: element.x,
      startElemY: element.y,
      startElemW: element.width,
      startElemH: element.height,
    });
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = (e.clientX - dragState.startX) / scale;
      const deltaY = (e.clientY - dragState.startY) / scale;

      let newX = dragState.startElemX;
      let newY = dragState.startElemY;
      let newW = dragState.startElemW;
      let newH = dragState.startElemH;

      if (dragState.mode === "move") {
        newX = Math.max(0, Math.min(1280 - newW, dragState.startElemX + deltaX));
        newY = Math.max(0, Math.min(720 - newH, dragState.startElemY + deltaY));
      } else if (dragState.mode === "resize-se") {
        newW = Math.max(80, Math.min(1280 - newX, dragState.startElemW + deltaX));
        newH = Math.max(20, Math.min(720 - newY, dragState.startElemH + deltaY));
      } else if (dragState.mode === "resize-e") {
        newW = Math.max(80, Math.min(1280 - newX, dragState.startElemW + deltaX));
      } else if (dragState.mode === "resize-s") {
        newH = Math.max(20, Math.min(720 - newY, dragState.startElemH + deltaY));
      }

      onUpdateElementPosition(activeSlide.id, dragState.elementId, newX, newY, newW, newH);
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, scale, activeSlide]);

  // 双击文字框进入编辑模式
  const handleDoubleClick = (e: React.MouseEvent, element: SlideElement) => {
    if (element.type !== "text") return;
    e.stopPropagation();
    setEditingText({ id: element.id, text: element.text });
  };

  const handleTextChangeSubmit = (elementId: string) => {
    if (editingText && editingText.id === elementId) {
      const targetElement = activeSlide.elements.find((el) => el.id === elementId);
      if (targetElement && targetElement.type === "text") {
        onUpdateElement(activeSlide.id, elementId, { ...targetElement, text: editingText.text });
      }
      setEditingText(null);
    }
  };

  // 根据模板计算页面样式
  const getThemeStyles = () => {
    let slideBg = "#fff";
    let titleColor = "#1e293b";
    let bodyColor = "#475569";
    let fontClass = "font-sans";
    let borderStyle = {};

    switch (selectedTheme) {
      case "nordic":
        slideBg = "#fbfbfa";
        titleColor = "#0f172a";
        bodyColor = "#334155";
        fontClass = "font-serif";
        borderStyle = { border: "1px solid rgba(15, 23, 42, 0.08)" };
        break;
      case "midnight":
        slideBg = "#0e1115";
        titleColor = "#f8fafc";
        bodyColor = "#94a3b8";
        fontClass = "font-mono";
        borderStyle = { border: "1px solid rgba(255, 255, 255, 0.08)" };
        break;
      case "ocean":
        slideBg = "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)";
        titleColor = "#f8fafc";
        bodyColor = "#cbd5e1";
        fontClass = "font-sans";
        borderStyle = { border: "1px solid rgba(14, 165, 233, 0.25)" };
        break;
      case "sunset":
        slideBg = "linear-gradient(135deg, #fffcf4 0%, #fff3e3 100%)";
        titleColor = "#3c2a21";
        bodyColor = "#776b5d";
        fontClass = "font-serif";
        borderStyle = { border: "1px solid rgba(120, 80, 40, 0.15)" };
        break;
      case "purple":
        slideBg = "radial-gradient(circle at top, #1c1537 0%, #0d091a 100%)";
        titleColor = "#f8fafc";
        bodyColor = "#b4befe";
        fontClass = "font-sans";
        borderStyle = { border: "1px solid rgba(168, 85, 247, 0.25)" };
        break;
    }

    // 强调色覆盖
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

    return { slideBg, titleColor, bodyColor, fontClass, borderStyle, accentColor };
  };

  const styles = getThemeStyles();
  const activeSlideBg = activeSlide
    ? resolveSlideBackgroundWithVariant(selectedTheme, selectedPalette, activeSlide).slideBg
    : styles.slideBg;

  return (
    <section className="canvas-column" onClick={() => onSelectElement(null)}>
      {/* 顶部画布控制栏 */}
      <div className="panel-header canvas-header">
        <div className="canvas-header-left">
          <div className="history-undo-redo">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="action-icon-btn"
              title="撤销操作 (Undo)"
            >
              <UndoIcon size={16} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="action-icon-btn"
              title="重做操作 (Redo)"
            >
              <RedoIcon size={16} />
            </button>
            <span className="revision-pill">版本 Rev {presentation.revision}</span>
          </div>
        </div>

        {/* 幻灯片翻页控制 */}
        <div className="slide-navigator">
          <button
            onClick={() => handleSlideSelect(activeSlideIndex - 1)}
            disabled={activeSlideIndex === 0}
            className="nav-arrow-btn"
          >
            ←
          </button>
          <span className="nav-slide-text">
            第 {activeSlideIndex + 1} 页，共 {slides.length} 页
          </span>
          <button
            onClick={() => handleSlideSelect(activeSlideIndex + 1)}
            disabled={activeSlideIndex === slides.length - 1}
            className="nav-arrow-btn"
          >
            →
          </button>
        </div>

        <div className="canvas-header-right">
          <button
            className="optimize-slide-btn"
            onClick={() => onOptimizeSlide(activeSlide.id)}
            title="AI 自动优化幻灯片页面对齐与排版分布"
          >
            <SparklesIcon size={14} />
            <span>AI 布局优化</span>
          </button>
          <div className="dropdown-export">
            <button className="secondary-btn">导出</button>
          </div>
          <button className="secondary-btn">协作分享</button>

          {/* ☀️ / 🌙 主题切换按钮 */}
          <button
            className="action-icon-btn theme-toggle-btn"
            onClick={onToggleThemeMode}
            title={themeMode === "light" ? "切换为深色框架" : "切换为浅色框架"}
            style={{ marginRight: 4 }}
          >
            {themeMode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
          </button>

          {/* 实时预览显示/隐藏按钮 */}
          <button
            className="action-icon-btn focus-toggle-btn"
            onClick={onToggleMirror}
            title={isMirrorOpen ? "关闭右侧预览" : "打开右侧预览"}
          >
            {isMirrorOpen ? <ClosePreviewIcon size={16} /> : <OpenPreviewIcon size={16} />}
          </button>
        </div>
      </div>

      {/* 画布核心工作区 */}
      <div className="canvas-workspace">
        <div
          ref={slideContainerRef}
          className="slide-canvas-aspect-wrapper"
          style={{ width: "min(100%, 960px)" }}
        >
          {activeSlide ? (
            <div
              className={`slide-viewport ${styles.fontClass}`}
              style={{
                background: activeSlideBg,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                ...styles.borderStyle,
              }}
            >
              {/* 品牌视觉 Logo */}
              {logoUrl && (
                <div className="slide-brand-logo">
                  <img src={logoUrl} alt="Logo" />
                </div>
              )}

              {/* 装饰页码 */}
              <div className="slide-page-number" style={{ color: styles.bodyColor }}>
                {activeSlideIndex + 1}
              </div>

              {/* 幻灯片大标题 */}
              {activeSlide.layout !== "cover" && activeSlide.layout !== "section" && (
                <div
                  className="slide-header-text"
                  style={{
                    color: styles.titleColor,
                    borderBottom: `2px solid ${styles.accentColor}`,
                  }}
                >
                  {activeSlide.title}
                </div>
              )}

              {/* 页内图层列表 */}
              {activeSlide.elements.map((element) => {
                const isSelected = selectedElementId === element.id;
                const isEditing = editingText && editingText.id === element.id;

                return (
                  <div
                    key={element.id}
                    className={`canvas-slide-element ${isSelected ? "selected" : ""}`}
                    style={{
                      left: element.x,
                      top: element.y,
                      width: element.width,
                      height: element.height,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectElement(element.id);
                    }}
                    onDoubleClick={(e) => handleDoubleClick(e, element)}
                    onMouseDown={(e) => handleMouseDown(e, element, "move")}
                  >
                    {/* 内容载体 */}
                    <div className="element-inner-content">
                      {element.type === "text" && (
                        isEditing ? (
                          <textarea
                            className="element-text-editor"
                            style={{
                              fontSize: element.fontSize,
                              color: element.color || styles.bodyColor,
                              fontWeight: element.bold ? "bold" : "normal",
                              textAlign: element.align || "left",
                              fontFamily: fontFamilyToCss(
                                resolveElementFontFamily(element, selectedTheme),
                              ),
                            }}
                            value={editingText.text}
                            onChange={(e) =>
                              setEditingText({ id: element.id, text: e.target.value })
                            }
                            onBlur={() => handleTextChangeSubmit(element.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleTextChangeSubmit(element.id);
                              }
                            }}
                            autoFocus
                          />
                        ) : (
                          <p
                            style={{
                              fontSize: element.fontSize,
                              color: element.color || styles.bodyColor,
                              fontWeight: element.bold ? "bold" : "normal",
                              textAlign: element.align || "left",
                              fontFamily: fontFamilyToCss(
                                resolveElementFontFamily(element, selectedTheme),
                              ),
                              whiteSpace: "pre-wrap",
                              margin: 0,
                            }}
                          >
                            {element.text}
                          </p>
                        )
                      )}

                      {element.type === "image" && (
                        <img
                          src={element.url}
                          alt="画布图片图层"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: element.objectFit || "cover",
                            borderRadius: `${element.borderRadius || 0}px`,
                            pointerEvents: "none",
                          }}
                        />
                      )}

                      {element.type === "shape" && <ShapeElementView element={element} />}

                      {(element.type === "chart" ||
                        element.type === "table" ||
                        element.type === "icon") && (
                        <SlideElementRenderer
                          element={element}
                          theme={selectedTheme}
                          bodyColor={styles.bodyColor}
                          accentColor={styles.accentColor}
                        />
                      )}
                    </div>

                    {/* 手工选中后的调节边框与操纵手柄 */}
                    {isSelected && !isEditing && (
                      <>
                        <div className="drag-border border-top"></div>
                        <div className="drag-border border-right"></div>
                        <div className="drag-border border-bottom"></div>
                        <div className="drag-border border-left"></div>

                        {/* 拉伸手柄 */}
                        <div
                          className="resize-handle handle-se"
                          onMouseDown={(e) => handleMouseDown(e, element, "resize-se")}
                        ></div>
                        <div
                          className="resize-handle handle-e"
                          onMouseDown={(e) => handleMouseDown(e, element, "resize-e")}
                        ></div>
                        <div
                          className="resize-handle handle-s"
                          onMouseDown={(e) => handleMouseDown(e, element, "resize-s")}
                        ></div>

                        {/* 浮动操作条 */}
                        <div
                          className="floating-element-toolbar"
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{ transform: `scale(${1 / scale})` }}
                        >
                          {element.type === "text" && (
                            <>
                              <button
                                title="增大字号"
                                onClick={() => {
                                  onUpdateElement(activeSlide.id, element.id, {
                                    ...element,
                                    fontSize: element.fontSize + 4,
                                  });
                                }}
                              >
                                A+
                              </button>
                              <button
                                title="减小字号"
                                onClick={() => {
                                  if (element.fontSize > 12) {
                                    onUpdateElement(activeSlide.id, element.id, {
                                      ...element,
                                      fontSize: element.fontSize - 4,
                                    });
                                  }
                                }}
                              >
                                A-
                              </button>
                              <button
                                className="toolbar-sparkle"
                                title="由 AI 重新润色段落"
                                onClick={() => {
                                  onProposePrompt(
                                    `将这段文字优化得更精炼大气：“${element.text}”`
                                  );
                                }}
                              >
                                <SparklesIcon size={12} />
                                <span>AI 润色</span>
                              </button>
                            </>
                          )}
                          
                          {element.type === "image" && (
                            <button
                              className="toolbar-sparkle"
                              title="由 AI 重新描述该图片"
                              onClick={() => {
                                onProposePrompt(
                                  `推荐一张关于PPT大纲插图的URL替换当前图片`
                                );
                              }}
                            >
                              <SparklesIcon size={12} />
                              <span>AI 换图</span>
                            </button>
                          )}

                          {element.type === "shape" && (
                            <button
                              className="toolbar-sparkle"
                              title="由 AI 改变当前形状配色"
                              onClick={() => {
                                onProposePrompt(
                                  `帮我将当前选中的几何形状配色调整得更协调优雅`
                                );
                              }}
                            >
                              <SparklesIcon size={12} />
                              <span>AI 配色</span>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="slide-viewport-empty">工作台未选中幻灯片页</div>
          )}
        </div>

        {/* 幻灯片整体浮动控制条 (增设添加画布图层按钮) */}
        {activeSlide && (
          <div className="slide-floating-actions-bar">
            {/* 增设：新增图层功能 */}
            <button
              onClick={() => onAddElement("text")}
              className="canvas-action-btn"
              title="在幻灯片中插入文本图层"
            >
              <PlusIcon size={14} />
              <span>添加文本</span>
            </button>
            <button
              onClick={() => onAddElement("shape")}
              className="canvas-action-btn"
              title="在幻灯片中插入几何形状"
            >
              <PlusIcon size={14} />
              <span>添加形状</span>
            </button>
            <button
              onClick={() => onAddElement("image")}
              className="canvas-action-btn"
              title="在幻灯片中插入外链图片"
            >
              <PlusIcon size={14} />
              <span>添加图片</span>
            </button>
            
            <div style={{ width: 1, height: 20, background: "var(--border-glass-focused)" }}></div>

            <button
              onClick={() => onDuplicateSlide(activeSlide.id)}
              className="canvas-action-btn"
              title="复制当前页"
            >
              <DuplicateIcon size={14} />
              <span>复制页</span>
            </button>
            <button
              onClick={onAddSlide}
              className="canvas-action-btn"
              title="新建空白页"
            >
              <PlusIcon size={14} />
              <span>新建页</span>
            </button>
            <button
              onClick={() => onDeleteSlide(activeSlide.id)}
              disabled={slides.length <= 1}
              className="canvas-action-btn delete"
              title="删除当前页"
            >
              <TrashIcon size={14} />
              <span>删除页</span>
            </button>
          </div>
        )}
      </div>

      {/* 底部页面轨条 */}
      <div className="canvas-thumbnails-strip">
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            className={`strip-thumbnail-card ${selectedSlideId === slide.id ? "active" : ""}`}
            onClick={() => handleSlideSelect(index)}
          >
            <div className="thumb-idx">{index + 1}</div>
            <div
              className="thumb-preview-box"
              style={{
                background: resolveSlideBackgroundWithVariant(
                  selectedTheme,
                  selectedPalette,
                  slide,
                ).slideBg,
              }}
            >
              <span className="thumb-text-title" style={{ color: styles.titleColor }}>
                {slide.title || "未命名页面"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
