import React, { useState, useRef, useEffect } from "react";
import { SendIcon, SparklesIcon } from "./Icons";
import type { ManagedModel } from "../modelCatalog";
import { getWorkspaceLabel } from "@shared/workspace";

interface UnifiedAgentInputProps {
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  
  // Bound settings
  models: ManagedModel[];
  selectedModelId: string;
  setSelectedModelId: (val: string) => void;
  executionStrategy: "REQUEST_APPROVAL" | "AUTO";
  setExecutionStrategy: (val: "REQUEST_APPROVAL" | "AUTO") => void;
  localStoragePath: string;
  setLocalStoragePath?: (val: string) => void;

  layoutMode: "center" | "bottom";
  triggerToast: (msg: string) => void;
  selectedSlideIndex: number | null;
  onClearContextTag: () => void;
  submitLabel?: string;
  placeholder?: string;
}

export const UnifiedAgentInput: React.FC<UnifiedAgentInputProps> = ({
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  models,
  selectedModelId,
  setSelectedModelId,
  executionStrategy,
  setExecutionStrategy,
  localStoragePath,
  setLocalStoragePath,
  layoutMode,
  triggerToast,
  selectedSlideIndex,
  onClearContextTag,
  submitLabel = "生成",
  placeholder,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Extract folder name from path for display
  const folderName = getWorkspaceLabel(localStoragePath || undefined);
  const hasWorkspace = Boolean(localStoragePath);

  const handleSend = () => {
    if (busy || !request.trim()) return;
    onSubmitRequest();

    // Refocus the textarea immediately after submitting request to prevent focus loss
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`unified-agent-input-container ${layoutMode === "center" ? "center-focal-mode" : "bottom-anchored-mode"}`}>
      
      {/* 居中模式下的提示标题 */}
      {layoutMode === "center" && (
        <div className="center-welcome-header text-center" style={{ marginBottom: "24px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: "700", margin: 0, fontFamily: "var(--font-display)", color: "var(--text-primary)", textAlign: "center" }}>
            您今天想制作什么样的主题 PPT？
          </h1>
        </div>
      )}

      {/* 三层主面板 (Triple-Deck Panel) */}
      <div className="double-deck-panel-card">
        
        {/* Row 1: Content Input Area (Textarea) */}
        <div className="input-textarea-row" style={{ padding: "14px 16px 8px 16px", background: "var(--bg-input-field)" }}>
          <textarea
            ref={textareaRef}
            value={request}
            onChange={(e) => onChangeRequest(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={
              placeholder || (
              selectedSlideIndex !== null
                ? `输入对第 ${selectedSlideIndex + 1} 页的局部指令（如：“把背景换成白色”、“增大字号”）...`
                : "输入修改意图，支持输入斜杠 / 唤醒快捷排版指令..."
              )
            }
            readOnly={busy}
            autoFocus
            rows={layoutMode === "center" ? 2 : 1}
            className="input-textarea"
            style={{
              width: "100%",
              border: "none",
              resize: "none",
              outline: "none",
              fontSize: "14px",
              cursor: busy ? "not-allowed" : "text",
              opacity: busy ? 0.75 : 1,
              transition: "opacity 0.2s ease"
            }}
          />
        </div>

        {/* Row 2: Functional Control Bar (中间功能区) */}
        <div className="functional-control-bar" style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px 12px 16px",
          background: "var(--bg-input-field)",
          borderBottom: "1px solid var(--border-glass)"
        }}>
          {/* Left functions */}
          <div className="functional-left" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              className="action-icon-btn upload-btn"
              title="上传外部参考资料 (暂未接入)"
              disabled={true}
              style={{ opacity: 0.4, cursor: "not-allowed" }}
            >
              ➕
            </button>
            <div className="select-strategy-wrapper">
              <select
                value={executionStrategy}
                onChange={(e) => setExecutionStrategy(e.target.value as any)}
                className="strategy-select"
                title="Agent 自治执行策略"
                disabled={busy}
              >
                <option value="REQUEST_APPROVAL">✍️ 策略：请求批准</option>
                <option value="AUTO">⚡ 策略：全自动运行</option>
              </select>
            </div>
          </div>

          {/* Right functions */}
          <div className="functional-right" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="model-tier-select-wrapper">
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="mini-model-select"
                title="智能体模型级别"
                disabled={busy}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>

            <button
              className="action-icon-btn mic-btn"
              title="语音输入 (暂未接入)"
              disabled={true}
              style={{ opacity: 0.4, cursor: "not-allowed" }}
            >
              🎤
            </button>

            <button
              onClick={handleSend}
              disabled={busy || !request.trim()}
              className="send-cta-btn"
              title="启动智能体工作流"
            >
              <SendIcon size={14} />
              <span>{submitLabel}</span>
            </button>
          </div>
        </div>

        {/* Lower Deck: workspace context */}
        {layoutMode === "center" && (
          <div className="lower-deck-bar" style={{ background: "rgba(0, 0, 0, 0.015)", borderTop: "1px solid var(--border-glass)" }}>
            
            <div className="context-left">
              <button
                className="context-anchor-tag"
                title={hasWorkspace ? `项目目录: ${localStoragePath}` : "请先打开项目目录"}
                disabled={true}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-glass)",
                  color: hasWorkspace ? "var(--text-muted)" : "#f59e0b",
                  fontFamily: "var(--font-body)",
                  fontSize: "11px",
                  padding: "3px 10px",
                  borderRadius: "12px",
                  cursor: "default",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  opacity: hasWorkspace ? 0.85 : 1,
                  transition: "var(--transition-smooth)",
                  boxShadow: "none"
                }}
              >
                📁 {hasWorkspace ? `项目目录: ${folderName}` : "未打开项目目录"}
              </button>
            </div>

            <div className="context-right">
              {selectedSlideIndex !== null ? (
                <span className="active-context-slide-pill">
                  📍 选中范围: 第 {selectedSlideIndex + 1} 页
                  <button className="close-slide-pill-btn" onClick={onClearContextTag}>✕</button>
                </span>
              ) : (
                <span className="context-global-pill" style={{ color: "var(--text-muted)", opacity: 0.6 }}>🌐 全局文档设计</span>
              )}
            </div>

          </div>
        )}

      </div>

    </div>
  );
};
