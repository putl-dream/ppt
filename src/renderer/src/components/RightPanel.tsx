import React, { useState, useRef, useEffect } from "react";
import { AgentApprovalRequest } from "@shared/ipc";
import { SlideElement } from "@shared/presentation";
import { BrainIcon, SendIcon, SparklesIcon, ChevronDownIcon, ChevronRightIcon, FileIcon } from "./Icons";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thought?: string[];
  progress?: number;
  approval?: AgentApprovalRequest;
}

interface RightPanelProps {
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  approval: AgentApprovalRequest | undefined;
  onResolveApproval: (approved: boolean) => void;
  selectedElement: SlideElement | null;
  activeSlideId: string;
  onUpdateElement: (slideId: string, elementId: string, element: SlideElement) => void;
  chatMessages: ChatMessage[];
  thoughtProcess: string[];
  thoughtProgress: number;
  onSuggestPrompt: (prompt: string) => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  approval,
  onResolveApproval,
  selectedElement,
  activeSlideId,
  onUpdateElement,
  chatMessages,
  thoughtProcess,
  thoughtProgress,
  onSuggestPrompt,
}) => {
  const [showThought, setShowThought] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 消息更新时自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, thoughtProcess, thoughtProgress, busy]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmitRequest();
    }
  };

  const handleSuggest = (prompt: string) => {
    onSuggestPrompt(prompt);
  };

  const promptSuggestions = [
    "新增一页关于业务增长的市场页",
    "将选中句子的表达语气调整得更精炼",
    "把当前页内容提取出 3 个要点",
    "将排版模板样式切换为流光极光",
  ];

  return (
    <aside className="right-panel">
      {/* 头部状态 */}
      <div className="panel-header right-header">
        <div className="right-header-title">
          <BrainIcon size={18} className="brain-glow-icon" />
          <span>AI 对话控制台</span>
        </div>
        <div className="status-indicator">
          <span className={`status-dot ${busy ? "active" : ""}`}></span>
          <span>{busy ? "智能体思考中" : "已连接"}</span>
        </div>
      </div>

      {/* 核心内容区：Inspector 调整面板或 Chat 列表 */}
      <div className="right-panel-body">
        {selectedElement ? (
          /* 图层元素选中状态 - 上下文细节编辑 */
          <div className="context-inspector">
            <div className="inspector-title">
              <SparklesIcon size={14} className="sparkle-accent" />
              <span>
                {selectedElement.type === "text" && "选中文字细节调整"}
                {selectedElement.type === "image" && "选中图片细节调整"}
                {selectedElement.type === "shape" && "选中形状细节调整"}
              </span>
            </div>
            
            <div className="inspector-content">
              <div className="selected-meta">
                <span className="element-badge">
                  {selectedElement.type === "text" && "文本图层"}
                  {selectedElement.type === "image" && "图片图层"}
                  {selectedElement.type === "shape" && "矢量几何"}
                </span>
                <span className="element-coords">
                  X:{Math.round(selectedElement.x)} Y:{Math.round(selectedElement.y)}
                </span>
              </div>

              {/* 分别根据图层类型渲染不同的调节项 */}
              
              {/* 1. TEXT 图层控制项 */}
              {selectedElement.type === "text" && (
                <>
                  {/* 直接修改文本 */}
                  <div className="inspector-field">
                    <label className="field-label">文本内容</label>
                    <textarea
                      className="inspector-textarea"
                      value={selectedElement.text}
                      onChange={(e) =>
                        onUpdateElement(activeSlideId, selectedElement.id, {
                          ...selectedElement,
                          text: e.target.value,
                        })
                      }
                    />
                  </div>

                  {/* 字号滑块 */}
                  <div className="inspector-field">
                    <div className="field-label-row">
                      <span className="field-label">字体大小</span>
                      <span className="field-value-badge">{selectedElement.fontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="120"
                      step="2"
                      className="inspector-slider"
                      value={selectedElement.fontSize}
                      onChange={(e) => {
                        const size = parseInt(e.target.value);
                        onUpdateElement(activeSlideId, selectedElement.id, {
                          ...selectedElement,
                          fontSize: size,
                        });
                      }}
                    />
                  </div>

                  {/* 语气快捷优化 */}
                  <div className="inspector-field">
                    <label className="field-label">一键调整表达语气</label>
                    <div className="tone-btn-grid">
                      <button
                        onClick={() => handleSuggest(`将以下文字润色得更有商务专业感：“${selectedElement.text}”`)}
                        className="tone-btn"
                      >
                        👔 专业商务
                      </button>
                      <button
                        onClick={() => handleSuggest(`将以下文字改写为更加亲和口语化：“${selectedElement.text}”`)}
                        className="tone-btn"
                      >
                        🌱 亲和口语
                      </button>
                      <button
                        onClick={() => handleSuggest(`将以下文字缩写得简明扼要：“${selectedElement.text}”`)}
                        className="tone-btn"
                      >
                        ⚡ 简明扼要
                      </button>
                      <button
                        onClick={() => handleSuggest(`将以下文字润色得更具慷慨激昂的感染力：“${selectedElement.text}”`)}
                        className="tone-btn"
                      >
                        ✨ 鼓舞人心
                      </button>
                    </div>
                  </div>

                  {/* AI 局部操作推荐 */}
                  <div className="inspector-field mt-4">
                    <label className="field-label">AI 快速命令集</label>
                    <div className="actions-chip-grid">
                      <button
                        className="action-chip"
                        onClick={() => handleSuggest(`为以下文案想一个亮眼并吸引人的短标题：“${selectedElement.text}”`)}
                      >
                        ✨ 亮点标题
                      </button>
                      <button
                        className="action-chip"
                        onClick={() => handleSuggest(`将这段段落文本梳理为 3 行要点大纲：“${selectedElement.text}”`)}
                      >
                        📝 梳理大纲
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* 2. IMAGE 图层控制项 */}
              {selectedElement.type === "image" && (
                <>
                  <div className="inspector-field">
                    <label className="field-label">图片链接 (URL)</label>
                    <input
                      type="text"
                      className="config-input"
                      value={selectedElement.url}
                      onChange={(e) =>
                        onUpdateElement(activeSlideId, selectedElement.id, {
                          ...selectedElement,
                          url: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="inspector-field">
                    <div className="field-label-row">
                      <span className="field-label">图层圆角</span>
                      <span className="field-value-badge">{selectedElement.borderRadius || 0}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="2"
                      className="inspector-slider"
                      value={selectedElement.borderRadius || 0}
                      onChange={(e) => {
                        const radius = parseInt(e.target.value);
                        onUpdateElement(activeSlideId, selectedElement.id, {
                          ...selectedElement,
                          borderRadius: radius,
                        });
                      }}
                    />
                  </div>

                  <div className="inspector-field mt-4">
                    <label className="field-label">AI 配图微调</label>
                    <div className="actions-chip-grid">
                      <button
                        className="action-chip"
                        onClick={() => handleSuggest(`推荐一张关于商业成功的扁平插画图片URL来替换当前选中的图片`)}
                      >
                        🖼️ 替换为商业插画
                      </button>
                      <button
                        className="action-chip"
                        onClick={() => handleSuggest(`为我查找一张高清的技术概念科技图来替换当前图片`)}
                      >
                        🌐 替换为科技渲染图
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* 3. SHAPE 形状控制项 */}
              {selectedElement.type === "shape" && (
                <>
                  <div className="inspector-field">
                    <label className="field-label">形状轮廓类型</label>
                    <div className="select-wrapper">
                      <select
                        value={selectedElement.shapeType}
                        onChange={(e) =>
                          onUpdateElement(activeSlideId, selectedElement.id, {
                            ...selectedElement,
                            shapeType: e.target.value as any,
                          })
                        }
                        className="model-select"
                      >
                        <option value="rectangle">矩形 (Rectangle)</option>
                        <option value="circle">椭圆 / 圆形 (Circle)</option>
                      </select>
                    </div>
                  </div>

                  <div className="inspector-field">
                    <label className="field-label">形状填充颜色</label>
                    <input
                      type="color"
                      style={{
                        width: "100%",
                        height: 38,
                        background: "none",
                        border: "1px solid var(--border-glass-focused)",
                        cursor: "pointer",
                        borderRadius: 6,
                        padding: 0
                      }}
                      value={selectedElement.fillColor || "#3b82f6"}
                      onChange={(e) =>
                        onUpdateElement(activeSlideId, selectedElement.id, {
                          ...selectedElement,
                          fillColor: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="inspector-field">
                    <label className="field-label">边框描边颜色</label>
                    <input
                      type="color"
                      style={{
                        width: "100%",
                        height: 38,
                        background: "none",
                        border: "1px solid var(--border-glass-focused)",
                        cursor: "pointer",
                        borderRadius: 6,
                        padding: 0
                      }}
                      value={selectedElement.strokeColor || "#1d4ed8"}
                      onChange={(e) =>
                        onUpdateElement(activeSlideId, selectedElement.id, {
                          ...selectedElement,
                          strokeColor: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="inspector-field mt-4">
                    <label className="field-label">AI 图例配色</label>
                    <div className="actions-chip-grid">
                      <button
                        className="action-chip"
                        onClick={() => handleSuggest(`把当前选中形状的填充色修改为符合北欧极简模板的经典灰褐色`)}
                      >
                        🎨 极简莫兰迪色
                      </button>
                      <button
                        className="action-chip"
                        onClick={() => handleSuggest(`帮我把当前形状边框去掉并改为渐变海洋色`)}
                      >
                        ✨ 海洋渐变无边框
                      </button>
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>
        ) : (
          /* 正常对话消息流 */
          <div className="chat-stream">
            {chatMessages.map((msg) => (
              <div key={msg.id} className={`chat-message ${msg.role}`}>
                <div className="chat-avatar">
                  {msg.role === "user" ? "我" : <BrainIcon size={14} />}
                </div>
                <div className="chat-bubble-content">
                  <div className="chat-bubble-text">{msg.content}</div>

                  {/* 展开的思考轨迹 */}
                  {msg.thought && msg.thought.length > 0 && (
                    <div className="thought-container">
                      <div className="thought-header" onClick={() => setShowThought(!showThought)}>
                        <span>Agent 思考推理轨迹</span>
                        {showThought ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                      </div>
                      {showThought && (
                        <ul className="thought-list">
                          {msg.thought.map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* 指令提交卡片 (Approval) */}
                  {msg.approval && (
                    <div className="approval-card">
                      <div className="approval-card-title">
                        <span>📋 待审核的排版更新单</span>
                      </div>
                      <p className="approval-summary">{msg.approval.summary}</p>
                      
                      <div className="approval-commands-list">
                        {msg.approval.commands.map((cmd) => (
                          <div key={cmd.id} className="approval-command-item">
                            <FileIcon size={12} className="cmd-icon" />
                            <span className="cmd-type">
                              {cmd.type === "add-slide" && "新增幻灯片"}
                              {cmd.type === "remove-slide" && "移除幻灯片"}
                              {cmd.type === "set-presentation-title" && "修改项目名称"}
                              {cmd.type === "set-slide-title" && "更改单页标题"}
                              {cmd.type === "add-element" && "添加画布元素"}
                              {cmd.type === "remove-element" && "移除画布元素"}
                              {cmd.type === "update-element" && "更新图层属性"}
                            </span>
                            {"title" in cmd && <span className="cmd-val">“{cmd.title}”</span>}
                            {"index" in cmd && <span className="cmd-val">位置: 第 {cmd.index === 2147483647 ? "尾" : cmd.index} 页</span>}
                          </div>
                        ))}
                      </div>

                      <div className="approval-buttons">
                        <button
                          disabled={busy}
                          onClick={() => onResolveApproval(false)}
                          className="btn-reject"
                        >
                          拒绝变更
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => onResolveApproval(true)}
                          className="btn-apply"
                        >
                          确认执行修改
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* 动态的 AI 思考状态表示 */}
            {busy && (
              <div className="chat-message assistant active-thinking">
                <div className="chat-avatar animate-pulse">
                  <BrainIcon size={14} />
                </div>
                <div className="chat-bubble-content">
                  <div className="chat-bubble-text">
                    {thoughtProgress < 100
                      ? "AI 正在编排排版指令流..."
                      : "指令编排完毕，等待指令确认执行..."}
                  </div>

                  {/* 实时思考步骤 */}
                  {thoughtProcess.length > 0 && (
                    <div className="thought-container">
                      <div className="thought-header">
                        <span>Agent 思考推理轨迹</span>
                        <ChevronDownIcon size={12} />
                      </div>
                      <ul className="thought-list">
                        {thoughtProcess.map((step, idx) => (
                          <li key={idx} className={idx === thoughtProcess.length - 1 ? "typing" : ""}>
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 渐变进度条 */}
                  <div className="progress-bar-container">
                    <div className="progress-bar-track">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${thoughtProgress}%` }}
                      ></div>
                    </div>
                    <span className="progress-percentage">{Math.round(thoughtProgress)}%</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 底部 Chat 输入区 */}
      <div className="right-panel-footer">
        {/* 指令推荐 chips */}
        {!busy && !selectedElement && (
          <div className="suggestion-chips-container">
            {promptSuggestions.map((suggestion, index) => (
              <button
                key={index}
                className="suggestion-chip"
                onClick={() => handleSuggest(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* 文本输入框 */}
        <div className="chat-input-box">
          <textarea
            value={request}
            onChange={(e) => onChangeRequest(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={
              selectedElement
                ? "发送针对选中元素的 AI 优化指令..."
                : "输入修改意图（如：'增加一页关于云安全市场规模的说明'）"
            }
            disabled={busy}
            rows={2}
            className="chat-textarea"
          />
          <button
            onClick={onSubmitRequest}
            disabled={busy || !request.trim()}
            className="send-btn-circle"
            title="提交排版意图"
          >
            <SendIcon size={16} />
          </button>
        </div>
        <div className="chat-input-tips">
          <span>💡 回车提议。控制台支持标准的 Markdown 输入格式。</span>
        </div>
      </div>
    </aside>
  );
};
