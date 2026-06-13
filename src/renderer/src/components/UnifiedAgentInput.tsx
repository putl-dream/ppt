import React, { useState, useRef, useEffect } from "react";
import { SendIcon, SparklesIcon } from "./Icons";

interface UnifiedAgentInputProps {
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: (compositePayload?: any) => void;
  busy: boolean;
  
  // Bound settings
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  executionStrategy: "REQUEST_APPROVAL" | "AUTO";
  setExecutionStrategy: (val: "REQUEST_APPROVAL" | "AUTO") => void;
  localStoragePath: string;
  setLocalStoragePath: (val: string) => void;

  layoutMode: "center" | "bottom";
  triggerToast: (msg: string) => void;
  selectedSlideIndex: number | null;
  onClearContextTag: () => void;
}

export const UnifiedAgentInput: React.FC<UnifiedAgentInputProps> = ({
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  selectedModel,
  setSelectedModel,
  executionStrategy,
  setExecutionStrategy,
  localStoragePath,
  setLocalStoragePath,
  layoutMode,
  triggerToast,
  selectedSlideIndex,
  onClearContextTag,
}) => {
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const voiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract folder name from path for display
  const folderName = localStoragePath.split("/").pop() || localStoragePath.split("\\").pop() || "ppt_workspace";

  const handleSend = () => {
    if (busy || !request.trim()) return;
    
    // Assemble the composite context payload
    const compositePayload = {
      prompt: request,
      executionStrategy: executionStrategy,
      modelTier: selectedModel,
      context: {
        projectFolder: folderName,
        runtimeMode: "LOCAL",
        gitBranch: "master",
      }
    };
    
    onSubmitRequest(compositePayload);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const simulateSpeechToText = () => {
    if (isVoiceActive) {
      setIsVoiceActive(false);
      if (voiceTimer.current) clearInterval(voiceTimer.current);
      triggerToast("🎤 语音录入结束");
    } else {
      setIsVoiceActive(true);
      triggerToast("🎤 正在聆听您的 PPT 创作要求...");
      let counter = 0;
      const phrases = [
        " 帮我添加一页关于商业模式的分析大纲",
        " 并且将整体颜色风格替换为商务蔚蓝",
        " 优化排版对齐比例"
      ];
      voiceTimer.current = setInterval(() => {
        if (counter < phrases.length) {
          onChangeRequest(request + phrases[counter]);
          counter++;
        } else {
          setIsVoiceActive(false);
          if (voiceTimer.current) clearInterval(voiceTimer.current);
          triggerToast("✨ 语音转文字识别已完成！");
        }
      }, 1500);
    }
  };

  const handleUploadClick = () => {
    triggerToast("➕ 正在模拟上传外部参考大纲 (支持 Word、PDF、PNG/JPG)...");
  };

  const handleSelectFolder = () => {
    const newPath = prompt("请输入您要锚定的项目空间文件夹目录：", localStoragePath);
    if (newPath) {
      setLocalStoragePath(newPath);
      triggerToast(`📁 已锚定新的项目空间环境: ${newPath}`);
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
            value={request}
            onChange={(e) => onChangeRequest(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={
              selectedSlideIndex !== null
                ? `输入对第 ${selectedSlideIndex + 1} 页的局部指令（如：“把背景换成白色”、“增大字号”）...`
                : "输入修改意图，支持输入斜杠 / 唤醒快捷排版指令..."
            }
            disabled={busy}
            rows={layoutMode === "center" ? 2 : 1}
            className="input-textarea"
            style={{ width: "100%", border: "none", resize: "none", outline: "none", fontSize: "14px", cursor: "text" }}
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
              onClick={handleUploadClick}
              className="action-icon-btn upload-btn"
              title="上传外部参考资料 (Word, PDF, 素材)"
              disabled={busy}
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
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="mini-model-select"
                title="智能体模型级别"
                disabled={busy}
              >
                <option value="gpt-5.5">GPT-5.5 (算力高)</option>
                <option value="gpt-5-mini">GPT-5 mini (流畅)</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6</option>
              </select>
            </div>

            <button
              onClick={simulateSpeechToText}
              className={`action-icon-btn mic-btn ${isVoiceActive ? "voice-listening-active" : ""}`}
              title={isVoiceActive ? "正在录音，再次点击停止" : "语音录入要求"}
              disabled={busy}
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
              <span>生成</span>
            </button>
          </div>
        </div>

        {/* Lower Deck: Context Infrastructure Bar (仅在居中巨幕模式下渲染，且使用静默浅灰效果弱化注意力) */}
        {layoutMode === "center" && (
          <div className="lower-deck-bar" style={{ background: "rgba(0, 0, 0, 0.015)", borderTop: "1px solid var(--border-glass)" }}>
            
            <div className="context-left">
              {/* Project folder space anchor tag */}
              <button
                className="context-anchor-tag"
                onClick={handleSelectFolder}
                title={`会话大纲与记忆将存放在此目录下: ${localStoragePath}`}
                disabled={busy}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-glass)",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-body)",
                  fontSize: "11px",
                  padding: "3px 10px",
                  borderRadius: "12px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  opacity: 0.65,
                  transition: "var(--transition-smooth)",
                  boxShadow: "none"
                }}
              >
                📁 项目存储目录: {folderName} <span>∨</span>
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
