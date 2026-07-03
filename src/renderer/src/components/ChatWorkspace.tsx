import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentApprovalRequest } from "@shared/ipc";
import type { SessionChatMessage } from "@shared/session";
import {
  CopyIcon,
  Edit3Icon,
  UndoIcon,
  RedoIcon,
  SunIcon,
  MoonIcon,
  ExpandIcon,
  CompressIcon,
  FileIcon,
} from "./Icons";
import { UnifiedAgentInput } from "./UnifiedAgentInput";
import { BriefCard } from "./BriefCard";
import { OutlineCard } from "./OutlineCard";
import { DeckPreviewCard } from "./DeckPreviewCard";
import { AgentThinkingLoader } from "./AgentThinkingLoader";
import { AgentActivityTrace } from "./AgentActivityTrace";
import { MessageMarkdown } from "./MessageMarkdown";
import type { AgentActivityItem } from "@shared/agent-activity";
import { resolveActivityTrace } from "@shared/agent-activity";
import type { ManagedModel } from "../modelCatalog";
import type { Presentation } from "@shared/presentation";
import type { InlineCardRef } from "@shared/inline-artifact-cards";
import type { BriefFields } from "@shared/project-artifacts";
import type { OutlineItem } from "@shared/project-artifacts";

type ChatMessage = SessionChatMessage;

export interface InlineCardData {
  refs: InlineCardRef[];
  briefFields?: BriefFields;
  outlineItems?: OutlineItem[];
  presentation?: Presentation;
}

interface ChatWorkspaceProps {
  isNewChat?: boolean;
  chatMessages: ChatMessage[];
  activityTrace: AgentActivityItem[];
  thoughtProgress: number;
  agentActivityMode: "idle" | "request" | "workflow" | "reasoning";
  activeToolName?: string | null;
  streamingMessageId?: string | null;
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  onResolveApproval: (approved: boolean, approval: AgentApprovalRequest, messageId: string) => void;
  onResolveToolApproval?: (approvalId: string, approved: boolean) => void;
  getInlineCardData: (message: ChatMessage) => InlineCardData;
  onConfirmBrief: (messageId: string) => void;
  onConfirmOutline: (messageId: string) => void;
  onReviseOutline: (messageId: string) => void;
  onOpenDeckPreview: () => void;
  onExportDeck: () => void;
  isExportingDeck?: boolean;
  selectedTheme: string;
  selectedPalette: string;
  activeRunId?: string | null;
  onCancelRun?: () => void;
  onRetry?: (msgId: string) => void;
  themeMode: "light" | "dark";
  onToggleThemeMode: () => void;
  isMirrorOpen: boolean;
  onToggleMirror: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedSlideIndex: number | null; // 右侧选中的幻灯片序号
  onClearContextTag: () => void;
  onUpdateMessageContent: (msgId: string, newContent: string) => void;
  onProposePrompt: (prompt: string) => void;

  // Bound settings for UnifiedAgentInput
  models: ManagedModel[];
  selectedModelId: string;
  setSelectedModelId: (val: string) => void;
  executionStrategy: "REQUEST_APPROVAL" | "AUTO";
  setExecutionStrategy: (val: "REQUEST_APPROVAL" | "AUTO") => void;
  localStoragePath: string;
  onSelectWorkspace: () => void;
  triggerToast: (msg: string) => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  isNewChat = false,
  chatMessages,
  activityTrace,
  thoughtProgress,
  agentActivityMode,
  activeToolName = null,
  streamingMessageId = null,
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  onResolveApproval,
  onResolveToolApproval,
  getInlineCardData,
  onConfirmBrief,
  onConfirmOutline,
  onReviseOutline,
  onOpenDeckPreview,
  onExportDeck,
  isExportingDeck,
  selectedTheme,
  selectedPalette,
  activeRunId,
  onCancelRun,
  onRetry,
  themeMode,
  onToggleThemeMode,
  isMirrorOpen,
  onToggleMirror,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  selectedSlideIndex,
  onClearContextTag,
  onUpdateMessageContent,
  onProposePrompt,
  
  // Bound props
  models,
  selectedModelId,
  setSelectedModelId,
  executionStrategy,
  setExecutionStrategy,
  localStoragePath,
  onSelectWorkspace,
  triggerToast,
}) => {
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const chatStreamRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((instant: boolean) => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    if (instant) {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, []);

  // 居中放大初始化页 vs 底部对话页，由 isNewChat 单独控制
  const showInitChat = isNewChat;

  // Listen to input slash commands
  useEffect(() => {
    if (request === "/" || request.startsWith("/")) {
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
    }
  }, [request]);

  useLayoutEffect(() => {
    scrollToBottom(busy);
  }, [chatMessages, activityTrace, thoughtProgress, busy, agentActivityMode, scrollToBottom]);

  useEffect(() => {
    const stream = chatStreamRef.current;
    const viewport = scrollViewportRef.current;
    if (!stream || !viewport) return;

    const observer = new ResizeObserver(() => {
      if (busy) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    observer.observe(stream);
    return () => observer.disconnect();
  }, [busy]);

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

  // Start editing message
  const handleStartEdit = (msgId: string, currentText: string) => {
    setEditingMsgId(msgId);
    setEditingText(currentText);
  };

  // Save edits back into the chat block content
  const handleSaveEdit = (msgId: string) => {
    onUpdateMessageContent(msgId, editingText);
    setEditingMsgId(null);
  };

  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      triggerToast("已复制到剪贴板");
    } catch {
      triggerToast("复制失败，请重试");
    }
  };

  // Render State A: Center Focal Mode (新建会话阶段 —— “居中巨幕控制台”)
  if (showInitChat) {
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
            models={models}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            executionStrategy={executionStrategy}
            setExecutionStrategy={setExecutionStrategy}
            localStoragePath={localStoragePath}
            onSelectWorkspace={onSelectWorkspace}
            layoutMode="center"
            triggerToast={triggerToast}
            selectedSlideIndex={selectedSlideIndex}
            onClearContextTag={onClearContextTag}
            submitLabel="生成"
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

          {/* 打开/关闭右侧预览 */}
          <button
            className="action-icon-btn focus-toggle-btn"
            onClick={onToggleMirror}
            title={isMirrorOpen ? "关闭右侧预览" : "打开右侧预览"}
          >
            {isMirrorOpen ? <CompressIcon size={16} /> : <ExpandIcon size={16} />}
          </button>
        </div>
      </div>

      {/* 核心 AI 对话信息流 */}
      <div className="chat-scroll-viewport" ref={scrollViewportRef}>
        <div className="chat-conversation-shell">
          <div className="chat-stream" ref={chatStreamRef}>
        {chatMessages.map((msg) => {
          const inlineCardData = msg.role === "assistant" ? getInlineCardData(msg) : null;

          return (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              {msg.role === "user" ? (
                <div className="user-message-bubble">
                  {editingMsgId === msg.id ? (
                    <div className="user-message-edit">
                      <textarea
                        className="chat-message-textarea"
                        value={editingText}
                        onChange={(e) => {
                          setEditingText(e.target.value);
                          e.target.style.height = "auto";
                          e.target.style.height = `${e.target.scrollHeight}px`;
                        }}
                        ref={(el) => {
                          if (el) {
                            el.style.height = "auto";
                            el.style.height = `${el.scrollHeight}px`;
                          }
                        }}
                        autoFocus
                      />
                      <div className="user-message-edit-actions">
                        <button
                          type="button"
                          onClick={() => setEditingMsgId(null)}
                          className="message-action-btn"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(msg.id)}
                          className="message-action-btn message-action-btn--primary"
                        >
                          保存并重新生成
                        </button>
                      </div>
                    </div>
                  ) : (
                    <MessageMarkdown content={msg.content} className="user-message-text" />
                  )}

                  {editingMsgId !== msg.id && (
                    <div className="user-message-actions">
                      <button
                        type="button"
                        className="message-action-btn"
                        onClick={() => void handleCopyMessage(msg.content)}
                        title="复制内容"
                      >
                        <CopyIcon size={13} />
                        <span>复制</span>
                      </button>
                      <button
                        type="button"
                        className="message-action-btn"
                        onClick={() => handleStartEdit(msg.id, msg.content)}
                        title="编辑指令并重新运行"
                      >
                        <Edit3Icon size={13} />
                        <span>编辑</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {(() => {
                    const useLiveTrace = busy && streamingMessageId === msg.id;
                    const trace = resolveActivityTrace({
                      activityTrace: useLiveTrace ? activityTrace : msg.activityTrace,
                      thought: useLiveTrace ? undefined : msg.thought,
                      reasoning: useLiveTrace ? undefined : msg.reasoning,
                    });
                    return trace.length > 0 ? (
                      <AgentActivityTrace
                        items={trace}
                        live={useLiveTrace}
                        onResolveToolApproval={onResolveToolApproval}
                      />
                    ) : null;
                  })()}

                  <MessageMarkdown content={msg.content} className="assistant-response" />

                  {onRetry && msg.content.includes("发生错误") && (
                  <button
                    onClick={() => onRetry(msg.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--accent-cyan)",
                      fontSize: "11px",
                      marginTop: "4px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    🔄 重试该指令
                  </button>
                )}

                {/* Deck 排版审批卡片 */}
                {msg.approval && (
                  <div className="approval-card" style={{ maxWidth: 540 }}>
                    <div className="approval-card-title">
                      <span>📋 待审核的排版更新</span>
                    </div>
                    <p className="approval-summary">{msg.approval.summary}</p>
                    {msg.approval.risk && (
                      <p className="approval-summary">
                        风险等级：{msg.approval.risk === "high" ? "高" : msg.approval.risk === "medium" ? "中" : "低"}
                      </p>
                    )}
                    {msg.approval.diff && (
                      <p className="approval-summary">
                        影响范围：{msg.approval.diff.affectedSlideIds.length} 页，新增元素 {msg.approval.diff.elementChanges.addedCount} 个，删除元素 {msg.approval.diff.elementChanges.removedCount} 个，更新元素 {msg.approval.diff.elementChanges.updatedCount} 个
                      </p>
                    )}
                    {msg.approval.assumptions && msg.approval.assumptions.length > 0 && (
                      <p className="approval-summary">
                        默认假设：{msg.approval.assumptions.join("；")}
                      </p>
                    )}
                    
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
                            {cmd.type === "set-theme" && "应用设计主题"}
                            {cmd.type === "update-slide-layout" && "更新页面布局"}
                            {cmd.type === "update-text-style" && "调整文字样式"}
                            {cmd.type === "move-element" && "移动图层位置"}
                            {cmd.type === "resize-element" && "调整图层大小"}
                            {cmd.type === "restore-slide-elements" && "还原图层状态"}
                          </span>
                          {"title" in cmd && <span className="cmd-val">“{cmd.title}”</span>}
                          {"index" in cmd && <span className="cmd-val">位置: 第 {cmd.index === 2147483647 ? "尾" : cmd.index} 页</span>}
                          {"theme" in cmd && (
                            <span className="cmd-val">
                              主题: {
                                cmd.theme === "nordic" ? "北欧极简" :
                                cmd.theme === "midnight" ? "黑客帝国" :
                                cmd.theme === "ocean" ? "商务蔚蓝" :
                                cmd.theme === "sunset" ? "落日余晖" :
                                cmd.theme === "purple" ? "流光极光" : cmd.theme
                              }
                              {cmd.palette && ` (色调: ${
                                cmd.palette === "cyan" ? "湖蓝" :
                                cmd.palette === "green" ? "科技绿" :
                                cmd.palette === "purple" ? "薰衣紫" :
                                cmd.palette === "orange" ? "珊瑚橙" : cmd.palette
                              })`}
                            </span>
                          )}
                          {"layout" in cmd && (
                            <span className="cmd-val">
                              布局: {
                                cmd.layout === "cover" ? "封面布局" :
                                cmd.layout === "section" ? "过渡页布局" :
                                cmd.layout === "concept" ? "概念排版" :
                                cmd.layout === "comparison" ? "左右对比" :
                                cmd.layout === "process" ? "流程步骤" :
                                cmd.layout === "architecture" ? "分层架构" :
                                cmd.layout === "case" ? "案例展示" :
                                cmd.layout === "summary" ? "总结要点" : cmd.layout
                              }
                            </span>
                          )}
                          {cmd.type === "update-text-style" && (
                            <span className="cmd-val">
                              {cmd.fontSize && `字号: ${cmd.fontSize}px `}
                              {cmd.bold !== undefined && `加粗: ${cmd.bold ? "是" : "否"} `}
                              {cmd.align && `对齐: ${
                                cmd.align === "left" ? "左" :
                                cmd.align === "center" ? "中" : "右"
                              }`}
                            </span>
                          )}
                          {(cmd.type === "move-element" || cmd.type === "resize-element") && (
                            <span className="cmd-val">
                              {"x" in cmd && `坐标: (${Math.round(cmd.x)}, ${Math.round(cmd.y)}) `}
                              {"width" in cmd && `尺寸: ${Math.round(cmd.width)}x${Math.round(cmd.height)}`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="approval-buttons">
                      <button
                        disabled={busy}
                        onClick={() => onResolveApproval(false, msg.approval!, msg.id)}
                        className="btn-reject"
                      >
                        拒绝变更
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => onResolveApproval(true, msg.approval!, msg.id)}
                        className="btn-apply"
                      >
                        确认执行修改
                      </button>
                    </div>
                  </div>
                )}

                {/* 产物内联预览卡片 */}
                {inlineCardData?.refs.map((card) => {
                  if (card.type === "brief" && inlineCardData.briefFields) {
                    return (
                      <BriefCard
                        key={`${msg.id}-brief`}
                        fields={inlineCardData.briefFields}
                        resolved={card.resolved}
                        onConfirm={card.resolved ? undefined : () => onConfirmBrief(msg.id)}
                      />
                    );
                  }

                  if (card.type === "outline" && inlineCardData.outlineItems?.length) {
                    return (
                      <OutlineCard
                        key={`${msg.id}-outline`}
                        items={inlineCardData.outlineItems}
                        resolved={card.resolved}
                        busy={busy}
                        onConfirm={card.resolved ? undefined : () => onConfirmOutline(msg.id)}
                        onRevise={card.resolved ? undefined : () => onReviseOutline(msg.id)}
                      />
                    );
                  }

                  if (card.type === "deck" && inlineCardData.presentation) {
                    return (
                      <DeckPreviewCard
                        key={`${msg.id}-deck`}
                        presentation={inlineCardData.presentation}
                        selectedTheme={selectedTheme}
                        selectedPalette={selectedPalette}
                        isExporting={isExportingDeck}
                        resolved={card.resolved}
                        onPreview={onOpenDeckPreview}
                        onExport={onExportDeck}
                      />
                    );
                  }

                  return null;
                })}
                </>
              )}
            </div>
          );
        })}

        {/* Agent 实时思考：工具调用列表 + 模型推理流 */}
        <AgentThinkingLoader
          busy={busy}
          agentActivityMode={agentActivityMode}
          activityTrace={activityTrace}
          activeToolName={activeToolName}
          suppressTrace={Boolean(streamingMessageId)}
          onResolveToolApproval={onResolveToolApproval}
        />

        <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* 底部统一控制台输入区 */}
      <div className="right-panel-footer chat-workspace-footer-unified">
        <div className="chat-conversation-shell chat-conversation-footer">
        
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
          models={models}
          selectedModelId={selectedModelId}
          setSelectedModelId={setSelectedModelId}
          executionStrategy={executionStrategy}
          setExecutionStrategy={setExecutionStrategy}
          localStoragePath={localStoragePath}
          onSelectWorkspace={onSelectWorkspace}
          layoutMode="bottom"
          triggerToast={triggerToast}
          selectedSlideIndex={selectedSlideIndex}
          onClearContextTag={onClearContextTag}
          submitLabel="生成"
        />
        </div>
      </div>

    </section>
  );
};
