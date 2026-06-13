import React, { useState, useRef, useEffect } from "react";
import { AgentApprovalRequest } from "@shared/ipc";
import {
  BrainIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  UndoIcon,
  RedoIcon,
  SunIcon,
  MoonIcon,
  ExpandIcon,
  CompressIcon,
  FileIcon,
} from "./Icons";
import { UnifiedAgentInput } from "./UnifiedAgentInput";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thought?: string[];
  progress?: number;
  approval?: AgentApprovalRequest;
}

interface ChatWorkspaceProps {
  chatMessages: ChatMessage[];
  thoughtProcess: string[];
  thoughtProgress: number;
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  approval: AgentApprovalRequest | undefined;
  onResolveApproval: (approved: boolean) => void;
  themeMode: "light" | "dark";
  onToggleThemeMode: () => void;
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedSlideIndex: number | null; // 右侧选中的幻灯片序号
  onClearContextTag: () => void;
  onUpdateMessageContent: (msgId: string, newContent: string) => void;
  onProposePrompt: (prompt: string) => void;

  // Bound settings for UnifiedAgentInput
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  executionStrategy: "REQUEST_APPROVAL" | "AUTO";
  setExecutionStrategy: (val: "REQUEST_APPROVAL" | "AUTO") => void;
  localStoragePath: string;
  setLocalStoragePath: (val: string) => void;
  triggerToast: (msg: string) => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  chatMessages,
  thoughtProcess,
  thoughtProgress,
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  approval,
  onResolveApproval,
  themeMode,
  onToggleThemeMode,
  isFocusMode,
  onToggleFocusMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  selectedSlideIndex,
  onClearContextTag,
  onUpdateMessageContent,
  onProposePrompt,
  
  // Bound props
  selectedModel,
  setSelectedModel,
  executionStrategy,
  setExecutionStrategy,
  localStoragePath,
  setLocalStoragePath,
  triggerToast,
}) => {
  const [showThought, setShowThought] = useState(true);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [editingLine, setEditingLine] = useState<{ msgId: string; lineIndex: number } | null>(null);
  const [editingText, setEditingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check if we are in the initial new session state (State A: Center Focal Mode)
  const isNewSession = chatMessages.length === 1 && chatMessages[0].id === "init";

  // Listen to input slash commands
  useEffect(() => {
    if (request === "/" || request.startsWith("/")) {
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
    }
  }, [request]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, thoughtProcess, thoughtProgress, busy]);

  const slashCommands = [
    { cmd: "/theme 商务蔚蓝", desc: "更改设计模板风格为商务蔚蓝" },
    { cmd: "/theme 黑客帝国", desc: "更改设计模板风格为科技酷黑" },
    { cmd: "/add-page ", desc: "在末尾添加指定标题的新幻灯片页" },
    { cmd: "/delete-page ", desc: "删除指定页码的幻灯片" },
    { cmd: "/rewrite ", desc: "对选中页面文本进行局部润色优化" },
  ];

  const promptSuggestions = [
    "新增一页关于产品推广的市场页",
    "将幻灯片整体语气调整得更具有商业说服力",
    "把第一页幻灯片文本内容提炼为要点列表",
    "将排版风格套用为商务蔚蓝主题",
  ];

  const handleSlashSelect = (cmd: string) => {
    onChangeRequest(cmd);
    setShowSlashMenu(false);
  };

  // Start editing single line
  const handleStartEdit = (msgId: string, lineIndex: number, currentText: string) => {
    setEditingLine({ msgId, lineIndex });
    setEditingText(currentText);
  };

  // Save edits back into the chat block content
  const handleSaveEdit = (msgId: string, lineIndex: number, originalLines: string[]) => {
    const updatedLines = [...originalLines];
    updatedLines[lineIndex] = editingText;
    onUpdateMessageContent(msgId, updatedLines.join("\n"));
    setEditingLine(null);
  };

  // Render State A: Center Focal Mode (新建会话阶段 —— “居中巨幕控制台”)
  if (isNewSession) {
    return (
      <section className="canvas-column chat-workspace-column center-focal-wrapper" style={{ background: "var(--bg-app)", height: "100%", display: "flex", flexDirection: "column" }}>
        
        {/* Top Header */}
        <div className="panel-header canvas-header" style={{ borderBottom: "none", background: "transparent" }}>
          <div className="canvas-header-left">
            <span className="revision-pill">AI 新建会话</span>
          </div>
          <div className="canvas-header-right">
            <button
              className="action-icon-btn theme-toggle-btn"
              onClick={onToggleThemeMode}
              title={themeMode === "light" ? "切换为深色框架" : "切换为浅色框架"}
            >
              {themeMode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
            </button>
          </div>
        </div>

        {/* Center content container */}
        <div className="center-focal-content-area" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "40px 20px" }}>
          
          <UnifiedAgentInput
            request={request}
            onChangeRequest={onChangeRequest}
            onSubmitRequest={onSubmitRequest}
            busy={busy}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            executionStrategy={executionStrategy}
            setExecutionStrategy={setExecutionStrategy}
            localStoragePath={localStoragePath}
            setLocalStoragePath={setLocalStoragePath}
            layoutMode="center"
            triggerToast={triggerToast}
            selectedSlideIndex={selectedSlideIndex}
            onClearContextTag={onClearContextTag}
          />

          {/* Quick recommendations suggestions below */}
          <div className="center-suggestions" style={{ marginTop: "28px", maxWidth: "680px", display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center" }}>
            {promptSuggestions.map((suggestion, index) => (
              <button
                key={index}
                className="suggestion-chip"
                onClick={() => onProposePrompt(suggestion)}
                style={{
                  background: "var(--bg-input-field)",
                  border: "1px solid var(--border-glass)",
                  padding: "8px 16px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "var(--transition-smooth)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.01)"
                }}
              >
                ✨ {suggestion}
              </button>
            ))}
          </div>

        </div>

      </section>
    );
  }

  // Render State B: Bottom-Anchored Split View (伴随式会话与双轨生成阶段 —— “底部承托控制台”)
  return (
    <section className="canvas-column chat-workspace-column" style={{ background: "var(--bg-app)" }}>
      
      {/* 顶部中央状态控制栏 */}
      <div className="panel-header canvas-header">
        <div className="canvas-header-left">
          <div className="history-undo-redo">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="action-icon-btn"
              title="撤销 (Undo)"
            >
              <UndoIcon size={16} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="action-icon-btn"
              title="重做 (Redo)"
            >
              <RedoIcon size={16} />
            </button>
            <span className="revision-pill">AI 指令中心</span>
          </div>
        </div>

        <div className="canvas-header-right">
          {/* 主题切换 */}
          <button
            className="action-icon-btn theme-toggle-btn"
            onClick={onToggleThemeMode}
            title={themeMode === "light" ? "切换为深色框架" : "切换为浅色框架"}
            style={{ marginRight: 4 }}
          >
            {themeMode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
          </button>

          {/* 收缩三栏沉浸模式 */}
          <button
            className="action-icon-btn focus-toggle-btn"
            onClick={onToggleFocusMode}
            title={isFocusMode ? "显示侧边栏" : "隐藏侧栏进入全局焦点模式"}
          >
            {isFocusMode ? <CompressIcon size={16} /> : <ExpandIcon size={16} />}
          </button>
        </div>
      </div>

      {/* 核心 AI 对话信息流 */}
      <div className="chat-stream" style={{ background: "transparent" }}>
        {chatMessages.map((msg) => {
          const lines = msg.content.split("\n");

          return (
            <div key={msg.id} className={`chat-message ${msg.role}`} style={{ maxWidth: "100%" }}>
              <div className="chat-avatar">
                {msg.role === "user" ? "我" : <BrainIcon size={14} />}
              </div>
              <div className="chat-bubble-content" style={{ flex: 1 }}>
                
                {/* AI 回复段落或 Markdown 树大纲 */}
                <div className="chat-bubble-text" style={{ padding: "12px 18px", width: "100%" }}>
                  {lines.map((line, idx) => {
                    const isLineEditing = editingLine?.msgId === msg.id && editingLine?.lineIndex === idx;

                    return (
                      <div key={idx} className="chat-message-line-container">
                        {isLineEditing ? (
                          <div className="flex gap-2 items-center" style={{ margin: "4px 0" }}>
                            <input
                              type="text"
                              className="title-input"
                              style={{ fontSize: 13, padding: "4px 8px" }}
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onBlur={() => handleSaveEdit(msg.id, idx, lines)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEdit(msg.id, idx, lines);
                              }}
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveEdit(msg.id, idx, lines)}
                              className="secondary-btn"
                              style={{ padding: "4px 8px", fontSize: 11 }}
                            >
                              保存
                            </button>
                          </div>
                        ) : (
                          <div
                            className="chat-hover-line-wrapper flex justify-between items-center group"
                            style={{ position: "relative", minHeight: 22 }}
                          >
                            <span style={{ fontSize: 13.5, lineHeight: 1.6 }}>{line}</span>
                            {msg.role === "assistant" && line.trim().length > 0 && (
                              <button
                                className="edit-line-btn opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => handleStartEdit(msg.id, idx, line)}
                                title="双击或点击此按钮编辑此行内容"
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "var(--accent-cyan)",
                                  cursor: "pointer",
                                  fontSize: 11,
                                  marginLeft: 8
                                }}
                              >
                                ✏️
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

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
                  <div className="approval-card" style={{ maxWidth: 540 }}>
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
          );
        })}

        {/* AI 思考状态 */}
        {busy && (
          <div className="chat-message assistant active-thinking" style={{ maxWidth: "100%" }}>
            <div className="chat-avatar animate-pulse">
              <BrainIcon size={14} />
            </div>
            <div className="chat-bubble-content" style={{ flex: 1 }}>
              <div className="chat-bubble-text" style={{ padding: "12px 18px" }}>
                {thoughtProgress < 100
                  ? "AI 正在编排排版指令流..."
                  : "指令编排完毕，等待指令确认执行..."}
              </div>

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

      {/* 底部统一控制台输入区 */}
      <div className="right-panel-footer chat-workspace-footer-unified" style={{ borderTop: "1px solid var(--border-glass)", padding: "16px 20px", position: "relative" }}>
        
        {/* 斜杠弹出指令 */}
        {showSlashMenu && (
          <div className="slash-menu-popup" style={{ bottom: "100%", left: "20px", right: "20px", marginBottom: "10px", position: "absolute", zIndex: 100 }}>
            <div className="slash-menu-header">💡 斜杠快捷指令集</div>
            {slashCommands.map((command, index) => (
              <div
                key={index}
                className="slash-menu-item"
                onClick={() => handleSlashSelect(command.cmd)}
              >
                <span className="cmd-text">{command.cmd}</span>
                <span className="cmd-desc">{command.desc}</span>
              </div>
            ))}
          </div>
        )}

        <UnifiedAgentInput
          request={request}
          onChangeRequest={onChangeRequest}
          onSubmitRequest={onSubmitRequest}
          busy={busy}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          executionStrategy={executionStrategy}
          setExecutionStrategy={setExecutionStrategy}
          localStoragePath={localStoragePath}
          setLocalStoragePath={setLocalStoragePath}
          layoutMode="bottom"
          triggerToast={triggerToast}
          selectedSlideIndex={selectedSlideIndex}
          onClearContextTag={onClearContextTag}
        />
      </div>

    </section>
  );
};
