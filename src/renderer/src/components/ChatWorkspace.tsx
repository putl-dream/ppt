import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentQuestionResolved } from "@shared/agent-question";
import type { DisplayEvent } from "@shared/card-display-protocol";
import type { SessionChatMessage } from "@shared/session";
import {
  ChevronRightIcon,
  CopyIcon,
  Edit3Icon,
  OpenPreviewIcon,
} from "./Icons";
import { UnifiedAgentInput } from "./UnifiedAgentInput";
import { AgentRunTimeline } from "./AgentRunTimeline";
import { MessageMarkdown } from "./MessageMarkdown";
import { AgentRunTerminalNotice } from "./AgentRunTerminalNotice";
import type { AgentActivityItem } from "@shared/agent-activity";
import { filterTraceForDisplay, markTraceComplete } from "@shared/agent-activity";
import { TaskPlanCard } from "./TaskPlanCard";
import type { ManagedModel } from "../modelCatalog";
import type { Presentation } from "@shared/presentation";
import {
  findActiveToolPermissionCard,
  usePermissionCardManager,
  useProgressCardManager,
} from "../cards/display-card-managers";
import { InteractionCardHost } from "../cards/hosts/InteractionCardHost";
import { ReviewCardHost } from "../cards/hosts/ReviewCardHost";
import { ArtifactCardHost } from "../cards/hosts/ArtifactCardHost";
import {
  collectTeamSessions,
} from "@shared/team-session";
import { FocusedTeamSession } from "./TeamSessionViews";
import type { AgentRunPhase } from "../agentRunPresentation";

type ChatMessage = SessionChatMessage;
type QuestionEvent = Extract<DisplayEvent, { kind: "interaction.question-requested" }>;
type CommandProposalEvent = Extract<DisplayEvent, { kind: "review.command-proposal" }>;
type PatchEvent = Extract<DisplayEvent, { kind: "review.patch-ready" }>;
type ArtifactEvent = Extract<DisplayEvent, { kind: "artifact.ready" }>;
type ConversationFocus =
  | { kind: "main" }
  | { kind: "team-session"; sessionId: string };

function getConversationFocusKey(focus: ConversationFocus): string {
  return focus.kind === "team-session" ? `team:${focus.sessionId}` : focus.kind;
}

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

interface ChatWorkspaceProps {
  isNewChat?: boolean;
  conversationTitle?: string;
  chatMessages: ChatMessage[];
  presentation?: Presentation;
  activityTrace: AgentActivityItem[];
  agentRunPhase: AgentRunPhase;
  streamingMessageId?: string | null;
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  onResolveApproval: (event: CommandProposalEvent, approved: boolean) => void;
  onResolvePatch: (event: PatchEvent, accepted: boolean) => void;
  onResolveQuestion: (event: QuestionEvent, resolved: AgentQuestionResolved) => void;
  onResolveToolApproval?: (approvalId: string, approved: boolean) => void;
  onReviseOutline: (event: ArtifactEvent) => void;
  onOpenDeckPreview: () => void;
  onExportDeck: () => void;
  isExportingDeck?: boolean;
  onFocusAffectedSlides?: (slideIds: string[]) => void;
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
  onPrepareWorkspace: () => void;
  triggerToast: (msg: string) => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  isNewChat = false,
  conversationTitle,
  chatMessages,
  presentation,
  activityTrace,
  agentRunPhase,
  streamingMessageId = null,
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  onResolveApproval,
  onResolvePatch,
  onResolveQuestion,
  onResolveToolApproval,
  onReviseOutline,
  onOpenDeckPreview,
  onExportDeck,
  isExportingDeck,
  onFocusAffectedSlides,
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
  const activeRunStartedAtRef = useRef<number | null>(null);
  if (busy && activeRunStartedAtRef.current === null) {
    activeRunStartedAtRef.current = Date.now();
  } else if (!busy) {
    activeRunStartedAtRef.current = null;
  }
  const [conversationFocus, setConversationFocus] = useState<ConversationFocus>({ kind: "main" });
  const [mainHasAttention, setMainHasAttention] = useState(false);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const pendingScrollRestoreRef = useRef<string | null>(null);
  const mainFingerprintRef = useRef<string | null>(null);
  const decisionReturnFocusRef = useRef<ConversationFocus | null>(null);
  const hadPendingDecisionRef = useRef(false);
  const sessionIdentityRef = useRef<string | null>(null);

  const managedPermissionCards = usePermissionCardManager((state) => state.cards);
  const managedPermission = findActiveToolPermissionCard(managedPermissionCards, activeRunId);
  const pendingToolApproval = managedPermission?.event.kind === "permission.tool-requested"
    ? managedPermission.event.payload
    : undefined;
  const pendingApprovalProps = pendingToolApproval
    ? {
        approvalId: pendingToolApproval.approvalId,
        toolName: pendingToolApproval.toolName,
        reason: pendingToolApproval.reason,
        detail: pendingToolApproval.detail,
      }
    : null;
  const managedProgressCards = useProgressCardManager((state) => state.cards);
  const managedTaskList = [...managedProgressCards].reverse().find((card) =>
    card.status === "active"
    && card.event.kind === "progress.task-list-updated"
    && (!activeRunId || card.event.scope.runId === activeRunId)
  );
  const managedTaskListPayload = managedTaskList?.event.kind === "progress.task-list-updated"
    ? managedTaskList.event.payload
    : undefined;

  const sessionGoal = chatMessages.find((message) => message.role === "user")?.content.trim() || null;
  const latestPlan = managedTaskListPayload
    ? {
        tasks: managedTaskListPayload.tasks,
        goal: managedTaskListPayload.goal ?? null,
        state: managedTaskListPayload.state,
        archive: managedTaskListPayload.archive,
      }
    : null;
  const activeTasks = latestPlan?.tasks ?? [];
  const planGoal = latestPlan ? (latestPlan.goal ?? null) : sessionGoal;
  const showTaskPlan = activeTasks.length > 0;
  const hasActiveTaskPlan = activeTasks.some((task) => task.status !== "completed");
  const displayConversationTitle = conversationTitle?.trim() || (isNewChat ? "AI 新建会话" : "当前对话");
  const teamSessions = useMemo(() => collectTeamSessions(
    [
      ...chatMessages.map((message) => message.activityTrace),
      activityTrace,
    ],
    activeTasks,
  ), [activeTasks, activityTrace, chatMessages]);
  const selectedTeamSession = conversationFocus.kind === "team-session"
    ? teamSessions.find((session) => session.id === conversationFocus.sessionId)
    : undefined;
  const focusKey = getConversationFocusKey(conversationFocus);
  const sessionIdentity = chatMessages[0]?.id ?? `empty:${displayConversationTitle}`;
  const mainFingerprint = useMemo(() => {
    const lastMessage = chatMessages.at(-1);
    const leadTrace = activityTrace.filter(
      (item) => item.kind !== "task" && item.kind !== "tasklist",
    );
    const lastLeadItem = leadTrace.at(-1);
    return [
      lastMessage?.id ?? "",
      lastMessage?.content.length ?? 0,
      busy ? "busy" : "idle",
      leadTrace.length,
      lastLeadItem?.id ?? "",
      lastLeadItem?.kind ?? "",
    ].join(":");
  }, [activityTrace, busy, chatMessages]);

  const canCancelRun = Boolean(busy && activeRunId && onCancelRun);

  const scrollToBottom = useCallback((instant: boolean) => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (instant || reducedMotion) {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, []);

  const switchConversationFocus = useCallback((nextFocus: ConversationFocus) => {
    const viewport = scrollViewportRef.current;
    if (viewport) scrollPositionsRef.current.set(focusKey, viewport.scrollTop);
    const nextKey = getConversationFocusKey(nextFocus);
    pendingScrollRestoreRef.current = nextKey;
    shouldFollowOutputRef.current = false;
    setConversationFocus(nextFocus);
    if (nextFocus.kind === "main") setMainHasAttention(false);
  }, [focusKey]);

  const focusTeamSession = useCallback((sessionId: string) => {
    switchConversationFocus({ kind: "team-session", sessionId });
  }, [switchConversationFocus]);

  const openPendingDecision = useCallback(() => {
    if (!pendingToolApproval) return;
    if (conversationFocus.kind !== "main") decisionReturnFocusRef.current = conversationFocus;
    switchConversationFocus({ kind: "main" });
    window.requestAnimationFrame(() => {
      shouldFollowOutputRef.current = true;
      scrollToBottom(true);
    });
  }, [conversationFocus, pendingToolApproval, scrollToBottom, switchConversationFocus]);

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

  useEffect(() => {
    if (sessionIdentityRef.current === null) {
      sessionIdentityRef.current = sessionIdentity;
      return;
    }
    if (sessionIdentityRef.current === sessionIdentity) return;
    sessionIdentityRef.current = sessionIdentity;
    scrollPositionsRef.current.clear();
    mainFingerprintRef.current = null;
    decisionReturnFocusRef.current = null;
    setMainHasAttention(false);
    setConversationFocus({ kind: "main" });
    shouldFollowOutputRef.current = true;
  }, [sessionIdentity]);

  useEffect(() => {
    if (
      conversationFocus.kind === "team-session"
      && !teamSessions.some((session) => session.id === conversationFocus.sessionId)
    ) {
      switchConversationFocus({ kind: "main" });
    }
  }, [conversationFocus, switchConversationFocus, teamSessions]);

  useEffect(() => {
    const previous = mainFingerprintRef.current;
    mainFingerprintRef.current = mainFingerprint;
    if (previous && previous !== mainFingerprint && conversationFocus.kind !== "main") {
      setMainHasAttention(true);
    }
  }, [conversationFocus.kind, mainFingerprint]);

  useEffect(() => {
    const pending = Boolean(pendingToolApproval);
    if (
      hadPendingDecisionRef.current
      && !pending
      && decisionReturnFocusRef.current
    ) {
      const returnFocus = decisionReturnFocusRef.current;
      decisionReturnFocusRef.current = null;
      switchConversationFocus(returnFocus);
    }
    hadPendingDecisionRef.current = pending;
  }, [pendingToolApproval, switchConversationFocus]);

  useLayoutEffect(() => {
    if (pendingScrollRestoreRef.current !== focusKey) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = scrollPositionsRef.current.get(focusKey) ?? 0;
    pendingScrollRestoreRef.current = null;
  }, [focusKey]);

  useLayoutEffect(() => {
    if (shouldFollowOutputRef.current) {
      scrollToBottom(busy);
    }
  }, [chatMessages, activityTrace, busy, agentRunPhase, scrollToBottom]);

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
      if (shouldFollowOutputRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    observer.observe(stream);
    return () => observer.disconnect();
  }, [busy]);

  const promptTemplates = [
    { cmd: "将整套演示统一为商务蓝视觉风格", desc: "提示：统一设计风格" },
    { cmd: "在末尾新增一页：", desc: "提示：追加页面" },
    { cmd: "删除第 页", desc: "提示：删除指定页" },
    { cmd: "润色当前页的文案，保持论点不变", desc: "提示：局部润色" },
  ];

  const promptSuggestions = [
    "做一份 8 页的产品发布会演示，面向企业客户，语气专业且有冲击力",
    "帮我准备季度业务汇报 PPT，包含进展、风险和下一步计划",
    "生成一套面向新员工的入职培训课件，结构清晰、便于讲解",
    "写一份产品方案介绍，突出问题、方案价值与落地路径",
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
      <section className="canvas-column chat-workspace-column center-focal-wrapper">

        {/* Top Header */}
        <div className="panel-header canvas-header center-focal-header">
          <div className="canvas-header-left">
            <div className="chat-session-title" title={displayConversationTitle}>
              <span>{displayConversationTitle}</span>
            </div>
          </div>
          <div className="canvas-header-right" />
        </div>

        {/* Center content container */}
        <div className="center-focal-content-area">

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
            onPrepareWorkspace={onPrepareWorkspace}
            agentRunPhase={agentRunPhase}
            activityTrace={activityTrace}
            runStartedAt={activeRunStartedAtRef.current ?? undefined}
          />

          <div className="center-suggestions">
            {promptSuggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                className="suggestion-chip"
                onClick={() => onProposePrompt(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>

        </div>

      </section>
    );
  }

  // Render State B: Bottom-Anchored Split View (伴随式会话与双轨生成阶段 —— “底部承托控制台”)
  return (
    <section className="canvas-column chat-workspace-column">

      {/* 顶部中央状态控制栏 */}
      <div className="panel-header canvas-header">
        <div className="canvas-header-left">
          <nav className="chat-session-breadcrumb" aria-label="任务焦点">
            <button
              type="button"
              className={`chat-session-crumb${conversationFocus.kind === "main" ? " is-current" : ""}`}
              onClick={() => switchConversationFocus({ kind: "main" })}
              title={displayConversationTitle}
              aria-current={conversationFocus.kind === "main" ? "page" : undefined}
            >
              <span>{displayConversationTitle}</span>
              {mainHasAttention && <i className="chat-session-attention-dot" aria-label="主任务有新动态" />}
            </button>
            {conversationFocus.kind !== "main" && (
              <ChevronRightIcon size={13} className="chat-session-crumb-separator" aria-hidden="true" />
            )}
            {conversationFocus.kind === "team-session" && selectedTeamSession && (
              <span className="chat-session-crumb is-current" aria-current="page">
                {selectedTeamSession.title}
              </span>
            )}
          </nav>
        </div>

        <div className="canvas-header-right">
          {pendingToolApproval && (
            <button
              type="button"
              className="team-decision-alert"
              onClick={openPendingDecision}
              aria-label={`需要授权：${pendingToolApproval.reason}`}
              title="跳转处理，完成后返回当前视图"
            >
              <span className="team-decision-alert-icon" aria-hidden="true">!</span>
              <span>需要授权</span>
              <b>1</b>
            </button>
          )}
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
        {conversationFocus.kind === "main" ? (
          <>
        {chatMessages.map((msg) => {
          const isLiveAssistantMessage =
            msg.role === "assistant" && busy && streamingMessageId === msg.id;
          return (
            <div
              key={msg.id}
              className={`chat-message ${msg.role}${isLiveAssistantMessage ? " is-active-run" : ""}`}
            >
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
                <div className="assistant-message-shell">
                  <div className="assistant-message-main">
                  {(() => {
                    const useLiveTrace = busy && streamingMessageId === msg.id;
                    const resolvedTrace = useLiveTrace
                      ? activityTrace
                      : msg.runStatus === "running"
                        ? (msg.activityTrace ?? [])
                        : markTraceComplete(
                            msg.activityTrace ?? [],
                            msg.runStatus === "failed"
                              ? "failed"
                              : msg.runStatus === "interrupted"
                                ? "denied"
                                : "failed",
                          );
                    const trace = filterTraceForDisplay(
                      resolvedTrace,
                      { keepTaskList: false },
                    );
                    if (msg.runId) {
                      return (
                        <AgentRunTimeline
                          items={trace}
                          content={msg.content}
                          live={useLiveTrace}
                          teamGraphTasks={activeTasks}
                        />
                      );
                    }
                    return msg.content ? (
                      <MessageMarkdown
                        content={msg.content}
                        className="assistant-response"
                      />
                    ) : null;
                  })()}

                  <AgentRunTerminalNotice
                    status={msg.runStatus}
                    error={msg.runError}
                    onRetry={onRetry ? () => onRetry(msg.id) : undefined}
                  />

                  <InteractionCardHost
                    host="timeline"
                    anchorMessageId={msg.id}
                    busy={busy}
                    onResolveQuestion={onResolveQuestion}
                  />

                <ReviewCardHost
                  anchorMessageId={msg.id}
                  busy={busy}
                  onResolveApproval={onResolveApproval}
                  onResolvePatch={onResolvePatch}
                  onFocusAffectedSlides={onFocusAffectedSlides}
                />

                <ArtifactCardHost
                  anchorMessageId={msg.id}
                  presentation={presentation}
                  busy={busy}
                  isExportingDeck={isExportingDeck}
                  onReviseOutline={onReviseOutline}
                  onOpenDeckPreview={onOpenDeckPreview}
                  onExportDeck={onExportDeck}
                />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <InteractionCardHost
          host="timeline"
          busy={busy}
          onResolveQuestion={onResolveQuestion}
        />

        <ReviewCardHost
          busy={busy}
          onResolveApproval={onResolveApproval}
          onResolvePatch={onResolvePatch}
          onFocusAffectedSlides={onFocusAffectedSlides}
        />

        <ArtifactCardHost
          presentation={presentation}
          busy={busy}
          isExportingDeck={isExportingDeck}
          onReviseOutline={onReviseOutline}
          onOpenDeckPreview={onOpenDeckPreview}
          onExportDeck={onExportDeck}
        />

        {showTaskPlan && conversationFocus.kind === "main" && (
          <TaskPlanCard
            goal={planGoal}
            tasks={activeTasks}
            live={busy || hasActiveTaskPlan}
            state={latestPlan?.state}
            archive={latestPlan?.archive}
            sessions={teamSessions}
            onOpenTask={focusTeamSession}
          />
        )}

          </>
        ) : selectedTeamSession ? (
          <FocusedTeamSession session={selectedTeamSession} />
        ) : null}

        <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* 底部统一控制台输入区 */}
      <div className="right-panel-footer chat-workspace-footer-unified">
        <div className="chat-conversation-shell chat-conversation-footer">

        {/* 斜杠弹出指令 */}
        {showSlashMenu && !pendingToolApproval && (
          <div className="slash-menu-popup" role="listbox" aria-label="提示词模板">
            <div className="slash-menu-header">提示词模板（填入输入框，不会直接执行）</div>
            {promptTemplates.map((command, index) => (
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

        <div>
          <InteractionCardHost
            host="composer-before-input"
            busy={busy}
            onResolveQuestion={onResolveQuestion}
          />
          {conversationFocus.kind !== "main" && !pendingToolApproval && (
            <div className="team-focus-composer-note">
              当前正在查看任务详情；这里发送的新指令仍会交给 PPT Agent。
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
            layoutMode="bottom"
            pendingToolApproval={pendingApprovalProps}
            onResolveToolApproval={onResolveToolApproval}
            canCancelRun={canCancelRun}
            onCancelRun={onCancelRun}
            isCancellingRun={isCancellingRun}
            sandboxReady
            agentRunPhase={agentRunPhase}
            activityTrace={activityTrace}
            runStartedAt={activeRunStartedAtRef.current ?? undefined}
          />
        </div>
        </div>
      </div>

    </section>
  );
};
