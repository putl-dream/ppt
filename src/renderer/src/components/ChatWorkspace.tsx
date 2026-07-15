import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentApprovalRequest } from "@shared/ipc";
import type { AgentQuestionResolved } from "@shared/agent-question";
import type { SessionChatMessage } from "@shared/session";
import {
  CopyIcon,
  Edit3Icon,
  OpenPreviewIcon,
  FileIcon,
} from "./Icons";
import { UnifiedAgentInput } from "./UnifiedAgentInput";
import { BriefCard } from "./BriefCard";
import { OutlineCard } from "./OutlineCard";
import { DeckPreviewCard } from "./DeckPreviewCard";
import { LayoutChoiceCard } from "./LayoutChoiceCard";
import { AgentThinkingLoader } from "./AgentThinkingLoader";
import { AgentActivityTrace } from "./AgentActivityTrace";
import { MessageMarkdown } from "./MessageMarkdown";
import { AgentQuestionCard } from "./AgentQuestionCard";
import type { AgentActivityItem } from "@shared/agent-activity";
import { findPendingToolApproval, resolveActivityTrace, filterTraceForDisplay, extractLatestTaskGraph } from "@shared/agent-activity";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import { TaskPlanCard } from "./TaskPlanCard";
import type { ManagedModel } from "../modelCatalog";
import type { Presentation } from "@shared/presentation";
import { visibleLayoutCardMessageIds, type InlineCardRef } from "@shared/inline-artifact-cards";
import type { BriefFields, OutlineItem } from "@shared/project-artifacts";
import type { LayoutVisualMode } from "@shared/layout-preference";
import { formatApprovalCommand } from "@shared/approval-command-display";
import type { DesignSystemV1 } from "@design-system";

type ChatMessage = SessionChatMessage;

interface UserMessageEditorProps {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function resizeMessageEditor(textarea: HTMLTextAreaElement) {
  const maxHeight = 320;
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

export const UserMessageEditor: React.FC<UserMessageEditorProps> = ({
  value,
  busy,
  onChange,
  onCancel,
  onSubmit,
}) => {
  const canSubmit = !busy && Boolean(value.trim());

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  return (
    <div className="user-message-editor" role="group" aria-label="编辑已发送的消息">
      <div className="user-message-editor-header">
        <span className="user-message-editor-title">编辑消息</span>
        <span className="user-message-editor-hint">提交后将从这里重新运行</span>
      </div>
      <textarea
        className="user-message-editor-textarea"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          resizeMessageEditor(event.target);
        }}
        onKeyDown={handleKeyDown}
        ref={(textarea) => {
          if (textarea) resizeMessageEditor(textarea);
        }}
        autoFocus
        rows={3}
        aria-label="修改消息内容"
      />
      <div className="user-message-editor-footer">
        <span className="user-message-editor-shortcut">Esc 取消 · Ctrl/⌘ Enter 提交</span>
        <div className="user-message-edit-actions">
          <button type="button" onClick={onCancel} className="message-action-btn">
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="message-action-btn message-action-btn--primary"
          >
            提交修改
          </button>
        </div>
      </div>
    </div>
  );
};

export interface InlineCardData {
  refs: InlineCardRef[];
  briefFields?: BriefFields;
  outlineItems?: OutlineItem[];
  presentation?: Presentation;
  layoutSlideCount?: number;
  layoutMode?: LayoutVisualMode;
}

interface ChatWorkspaceProps {
  isNewChat?: boolean;
  conversationTitle?: string;
  chatMessages: ChatMessage[];
  activityTrace: AgentActivityItem[];
  taskPlanSnapshot?: { tasks: AgentTaskNode[]; goal?: string | null } | null;
  thoughtProgress: number;
  agentActivityMode: "idle" | "request" | "workflow" | "reasoning";
  streamingMessageId?: string | null;
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  onResolveApproval: (approved: boolean, approval: AgentApprovalRequest, messageId: string) => void;
  onResolveQuestion: (messageId: string, resolved: AgentQuestionResolved) => void;
  onResolveToolApproval?: (approvalId: string, approved: boolean) => void;
  getInlineCardData: (message: ChatMessage) => InlineCardData;
  onConfirmBrief: (messageId: string) => void;
  onConfirmOutline: (messageId: string) => void;
  onConfirmLayout: (messageId: string, mode: LayoutVisualMode, designSystem: DesignSystemV1) => void;
  onReviseOutline: (messageId: string) => void;
  onOpenDeckPreview: () => void;
  onExportDeck: () => void;
  isExportingDeck?: boolean;
  selectedDesignSystem: DesignSystemV1;
  activeRunId?: string | null;
  onCancelRun?: () => void;
  isCancellingRun?: boolean;
  onRetry?: (msgId: string) => void;
  isMirrorOpen: boolean;
  onToggleMirror: () => void;
  onUpdateMessageContent: (msgId: string, newContent: string) => void;
  onProposePrompt: (prompt: string) => void;

  // Bound settings for UnifiedAgentInput
  models: ManagedModel[];
  selectedModelId: string;
  setSelectedModelId: (val: string) => void;
  workspaceReady: boolean;
  sandboxName: string;
  onPrepareWorkspace: () => void;
  triggerToast: (msg: string) => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  isNewChat = false,
  conversationTitle,
  chatMessages,
  activityTrace,
  taskPlanSnapshot,
  thoughtProgress,
  agentActivityMode,
  streamingMessageId = null,
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  onResolveApproval,
  onResolveQuestion,
  onResolveToolApproval,
  getInlineCardData,
  onConfirmBrief,
  onConfirmOutline,
  onConfirmLayout,
  onReviseOutline,
  onOpenDeckPreview,
  onExportDeck,
  isExportingDeck,
  selectedDesignSystem,
  activeRunId,
  onCancelRun,
  isCancellingRun = false,
  onRetry,
  isMirrorOpen,
  onToggleMirror,
  onUpdateMessageContent,
  onProposePrompt,
  
  // Bound props
  models,
  selectedModelId,
  setSelectedModelId,
  workspaceReady,
  sandboxName,
  onPrepareWorkspace,
  triggerToast,
}) => {
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const chatStreamRef = useRef<HTMLDivElement>(null);
  const shouldFollowOutputRef = useRef(true);

  const pendingToolApproval = busy
    ? findPendingToolApproval(activityTrace)
    : undefined;
  const pendingApprovalProps = pendingToolApproval
    ? {
        approvalId: pendingToolApproval.approvalId,
        toolName: pendingToolApproval.toolName,
        reason: pendingToolApproval.reason,
        detail: pendingToolApproval.detail,
      }
    : null;

  const sessionGoal = chatMessages.find((message) => message.role === "user")?.content.trim() || null;
  const messageTraces = chatMessages
    .map((message) => message.activityTrace)
    .filter((trace): trace is NonNullable<typeof trace> => Boolean(trace?.length));
  const latestPlan = taskPlanSnapshot ?? extractLatestTaskGraph(
    busy ? activityTrace : undefined,
    ...messageTraces.slice().reverse(),
  );
  const activeTasks = latestPlan?.tasks ?? [];
  const planGoal = latestPlan ? (latestPlan.goal ?? null) : sessionGoal;
  const showTaskPlan = activeTasks.length > 0;
  const hasActiveTaskPlan = activeTasks.some((task) => task.status !== "completed");
  const layoutCardMessageIds = visibleLayoutCardMessageIds(chatMessages);
  const displayConversationTitle = conversationTitle?.trim() || (isNewChat ? "AI 新建会话" : "当前对话");

  const canCancelRun = Boolean(busy && activeRunId && onCancelRun);

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
    if (shouldFollowOutputRef.current) {
      scrollToBottom(busy);
    }
  }, [chatMessages, activityTrace, thoughtProgress, busy, agentActivityMode, scrollToBottom]);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const updateFollowMode = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldFollowOutputRef.current = distanceFromBottom <= 56;
    };

    viewport.addEventListener("scroll", updateFollowMode, { passive: true });
    return () => viewport.removeEventListener("scroll", updateFollowMode);
  }, []);

  useEffect(() => {
    const stream = chatStreamRef.current;
    const viewport = scrollViewportRef.current;
    if (!stream || !viewport) return;

    const observer = new ResizeObserver(() => {
      if (busy && shouldFollowOutputRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    observer.observe(stream);
    return () => observer.disconnect();
  }, [busy]);

  const slashCommands = [
    { cmd: "/design 商务蓝", desc: "应用商务蓝设计系统" },
    { cmd: "/design 科技暗色", desc: "应用科技暗色设计系统" },
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
    shouldFollowOutputRef.current = false;
    setEditingMsgId(msgId);
    setEditingText(currentText);
  };

  const handleCancelEdit = () => {
    setEditingMsgId(null);
    setEditingText("");
  };

  // Replace this branch with the edited prompt and run it again.
  const handleSaveEdit = (msgId: string) => {
    const nextContent = editingText.trim();
    if (!nextContent || busy) return;
    shouldFollowOutputRef.current = true;
    setEditingMsgId(null);
    setEditingText("");
    onUpdateMessageContent(msgId, nextContent);
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
      <section className="canvas-column chat-workspace-column center-focal-wrapper" style={{ background: "var(--bg-canvas)", height: "100%", display: "flex", flexDirection: "column" }}>
        
        {/* Top Header */}
        <div className="panel-header canvas-header" style={{ background: "transparent" }}>
          <div className="canvas-header-left">
            <div className="chat-session-title" title={displayConversationTitle}>
              <span>{displayConversationTitle}</span>
            </div>
          </div>
          <div className="canvas-header-right" />
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
            layoutMode="center"
            pendingToolApproval={pendingApprovalProps}
            onResolveToolApproval={onResolveToolApproval}
            canCancelRun={canCancelRun}
            onCancelRun={onCancelRun}
            isCancellingRun={isCancellingRun}
            sandboxReady={workspaceReady}
            sandboxName={sandboxName}
            onPrepareWorkspace={onPrepareWorkspace}
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
    <section className="canvas-column chat-workspace-column" style={{ background: "var(--bg-canvas)" }}>
      
      {/* 顶部中央状态控制栏 */}
      <div className="panel-header canvas-header">
        <div className="canvas-header-left">
          <div className="chat-session-title" title={displayConversationTitle}>
            <span>{displayConversationTitle}</span>
          </div>
        </div>

        <div className="canvas-header-right">
          {/* 打开右侧预览；关闭入口固定在右侧 PPT 面板最右侧 */}
          {!isMirrorOpen && (
            <button
              className="action-icon-btn focus-toggle-btn"
              onClick={onToggleMirror}
              aria-label="打开右侧预览"
              title="打开右侧预览"
            >
              <OpenPreviewIcon size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 核心 AI 对话信息流 */}
      <div className="chat-scroll-viewport" ref={scrollViewportRef}>
        <div className="chat-conversation-shell">
          <div className="chat-stream" ref={chatStreamRef}>
        {chatMessages.map((msg) => {
          const inlineCardData = msg.role === "assistant" ? getInlineCardData(msg) : null;
          const suppressRepeatedLayoutPrompt = Boolean(
            msg.role === "assistant"
            && msg.inlineCards?.some((card) => card.type === "layout")
            && !layoutCardMessageIds.has(msg.id)
            && /内容草稿已就绪[\s\S]*待排版[\s\S]*请选择/.test(msg.content),
          );

          return (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              {msg.role === "user" ? (
                <div className={`user-message-shell${editingMsgId === msg.id ? " is-editing" : ""}`}>
                  <div className={`user-message-bubble${editingMsgId === msg.id ? " is-editing" : ""}`}>
                    {editingMsgId === msg.id ? (
                      <UserMessageEditor
                        value={editingText}
                        busy={busy}
                        onChange={setEditingText}
                        onCancel={handleCancelEdit}
                        onSubmit={() => handleSaveEdit(msg.id)}
                      />
                    ) : (
                      <MessageMarkdown content={msg.content} className="user-message-text" />
                    )}
                  </div>

                  {editingMsgId !== msg.id && (
                    <div className="user-message-actions">
                      <button
                        type="button"
                        className="message-action-btn message-action-btn--icon"
                        onClick={() => void handleCopyMessage(msg.content)}
                        title="复制内容"
                        aria-label="复制内容"
                      >
                        <CopyIcon size={13} />
                      </button>
                      <button
                        type="button"
                        className="message-action-btn message-action-btn--icon"
                        onClick={() => handleStartEdit(msg.id, msg.content)}
                        disabled={busy}
                        title="编辑指令并重新运行"
                        aria-label="编辑指令并重新运行"
                      >
                        <Edit3Icon size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {(() => {
                    const useLiveTrace = busy && streamingMessageId === msg.id;
                    // 实时消息的任务计划由输入框上方的浮动卡片展示，历史消息则内联到时间线中
                    const resolvedTrace = useLiveTrace
                      ? activityTrace
                      : resolveActivityTrace({
                          activityTrace: msg.activityTrace,
                          thought: msg.thought,
                          reasoning: msg.reasoning,
                        });
                    const trace = filterTraceForDisplay(
                      resolvedTrace,
                      { keepTaskGraph: !useLiveTrace && !showTaskPlan },
                    );
                    const hasRunningTeammate = trace.some(
                      (item) => item.kind === "task" && item.status === "running",
                    );
                    const traceIsLive = useLiveTrace || hasRunningTeammate;
                    return trace.length > 0 || (useLiveTrace && msg.content.trim()) ? (
                      <AgentActivityTrace
                        items={trace}
                        live={traceIsLive}
                        liveContent={useLiveTrace ? msg.content : undefined}
                      />
                    ) : null;
                  })()}

                  {!(busy && streamingMessageId === msg.id) && !suppressRepeatedLayoutPrompt && (
                    <MessageMarkdown content={msg.content} className="assistant-response" />
                  )}

                  {msg.question && (
                    <AgentQuestionCard
                      question={msg.question}
                      disabled={busy}
                      onResolve={(resolved) => onResolveQuestion(msg.id, resolved)}
                    />
                  )}

                  {onRetry && msg.content.includes("发生错误") && (
                  <button
                    onClick={() => onRetry(msg.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--accent-primary)",
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
                  <div className="approval-card">
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
                      {msg.approval.commands.map((cmd) => {
                        const display = formatApprovalCommand(cmd);
                        return (
                          <div key={cmd.id} className="approval-command-item">
                            <FileIcon size={12} className="cmd-icon" />
                            <span className="cmd-type">{display.label}</span>
                            {display.detail && <span className="cmd-val">{display.detail}</span>}
                          </div>
                        );
                      })}
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

                  if (card.type === "layout") {
                    if (!layoutCardMessageIds.has(msg.id)) return null;
                    return (
                      <LayoutChoiceCard
                        key={`${msg.id}-layout`}
                        slideCount={inlineCardData.layoutSlideCount ?? 1}
                        resolved={card.resolved}
                        layoutMode={inlineCardData.layoutMode ?? card.layoutMode}
                        selectedDesignSystem={selectedDesignSystem}
                        onConfirm={card.resolved
                          ? undefined
                          : (mode, designSystem) => onConfirmLayout(msg.id, mode, designSystem)}
                      />
                    );
                  }

                  if (card.type === "deck" && inlineCardData.presentation) {
                    return (
                      <DeckPreviewCard
                        key={`${msg.id}-deck`}
                        presentation={inlineCardData.presentation}
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
          suppressTrace={Boolean(streamingMessageId)}
        />

        <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* 底部统一控制台输入区 */}
      <div className="right-panel-footer chat-workspace-footer-unified">
        <div className="chat-conversation-shell chat-conversation-footer">
        
        {/* 斜杠弹出指令 */}
        {showSlashMenu && !pendingToolApproval && (
          <div className="slash-menu-popup" role="listbox" aria-label="快捷指令">
            <div className="slash-menu-header">💡 斜杠快捷指令集</div>
            {slashCommands.map((command, index) => (
              <button
                type="button"
                key={index}
                className="slash-menu-item"
                onClick={() => handleSlashSelect(command.cmd)}
              >
                <span className="cmd-text">{command.cmd}</span>
                <span className="cmd-desc">{command.desc}</span>
              </button>
            ))}
          </div>
        )}

        <div className={showTaskPlan ? "chat-input-stack" : undefined}>
          {showTaskPlan && (
            <TaskPlanCard
              goal={planGoal}
              tasks={activeTasks}
              live={busy || hasActiveTaskPlan}
            />
          )}
          <UnifiedAgentInput
            request={request}
            onChangeRequest={onChangeRequest}
            onSubmitRequest={onSubmitRequest}
            busy={busy}
            models={models}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            layoutMode="bottom"
            pendingToolApproval={pendingApprovalProps}
            onResolveToolApproval={onResolveToolApproval}
            canCancelRun={canCancelRun}
            onCancelRun={onCancelRun}
            isCancellingRun={isCancellingRun}
            sandboxReady
            sandboxName={sandboxName}
          />
        </div>
        </div>
      </div>

    </section>
  );
};
