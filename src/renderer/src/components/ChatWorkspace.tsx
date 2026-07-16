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
import { AgentThinkingLoader } from "./AgentThinkingLoader";
import { AgentActivityTrace } from "./AgentActivityTrace";
import { MessageMarkdown } from "./MessageMarkdown";
import type { AgentActivityItem } from "@shared/agent-activity";
import { resolveActivityTrace, filterTraceForDisplay } from "@shared/agent-activity";
import { TaskPlanCard } from "./TaskPlanCard";
import type { ManagedModel } from "../modelCatalog";
import type { Presentation } from "@shared/presentation";
import type { LayoutVisualMode } from "@shared/layout-preference";
import type { DesignSystemV1 } from "@design-system";
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
  type TeamSessionProjection,
} from "@shared/team-session";
import {
  FocusedTeamSession,
  LeadWaitingState,
  TeamOverview,
} from "./TeamSessionViews";

type ChatMessage = SessionChatMessage;
type QuestionEvent = Extract<DisplayEvent, { kind: "interaction.question-requested" }>;
type LayoutEvent = Extract<DisplayEvent, { kind: "interaction.layout-required" }>;
type CommandProposalEvent = Extract<DisplayEvent, { kind: "review.command-proposal" }>;
type PatchEvent = Extract<DisplayEvent, { kind: "review.patch-ready" }>;
type ArtifactEvent = Extract<DisplayEvent, { kind: "artifact.ready" }>;
type ConversationFocus =
  | { kind: "main" }
  | { kind: "overview" }
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
  thoughtProgress: number;
  agentActivityMode: "idle" | "request" | "workflow" | "reasoning";
  streamingMessageId?: string | null;
  request: string;
  onChangeRequest: (val: string) => void;
  onSubmitRequest: () => void;
  busy: boolean;
  onResolveApproval: (event: CommandProposalEvent, approved: boolean) => void;
  onResolvePatch: (event: PatchEvent, accepted: boolean) => void;
  onResolveQuestion: (event: QuestionEvent, resolved: AgentQuestionResolved) => void;
  onResolveToolApproval?: (approvalId: string, approved: boolean) => void;
  onConfirmBrief: (event: ArtifactEvent) => void;
  onConfirmOutline: (event: ArtifactEvent) => void;
  onConfirmLayout: (event: LayoutEvent, mode: LayoutVisualMode, designSystem: DesignSystemV1) => void;
  onReviseOutline: (event: ArtifactEvent) => void;
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
  presentation,
  activityTrace,
  thoughtProgress,
  agentActivityMode,
  streamingMessageId = null,
  request,
  onChangeRequest,
  onSubmitRequest,
  busy,
  onResolveApproval,
  onResolvePatch,
  onResolveQuestion,
  onResolveToolApproval,
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
  const [conversationFocus, setConversationFocus] = useState<ConversationFocus>({ kind: "main" });
  const [teamAttentionIds, setTeamAttentionIds] = useState<Set<string>>(() => new Set());
  const [mainHasAttention, setMainHasAttention] = useState(false);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const pendingScrollRestoreRef = useRef<string | null>(null);
  const teamSnapshotsRef = useRef(new Map<string, TeamSessionProjection>());
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
  const managedTaskGraph = [...managedProgressCards].reverse().find((card) =>
    card.status === "active"
    && card.event.kind === "progress.task-graph-updated"
    && (!activeRunId || card.event.scope.runId === activeRunId)
  );
  const managedTaskGraphPayload = managedTaskGraph?.event.kind === "progress.task-graph-updated"
    ? managedTaskGraph.event.payload
    : undefined;

  const sessionGoal = chatMessages.find((message) => message.role === "user")?.content.trim() || null;
  const latestPlan = managedTaskGraphPayload
    ? { tasks: managedTaskGraphPayload.tasks, goal: managedTaskGraphPayload.goal ?? null }
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
  const runningTeamCount = teamSessions.filter((session) => session.status === "running").length;
  const focusKey = getConversationFocusKey(conversationFocus);
  const sessionIdentity = chatMessages[0]?.id ?? `empty:${displayConversationTitle}`;
  const mainFingerprint = useMemo(() => {
    const lastMessage = chatMessages.at(-1);
    const leadTrace = activityTrace.filter(
      (item) => item.kind !== "task" && item.kind !== "taskgraph",
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
    if (instant) {
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
    if (nextFocus.kind === "team-session") {
      setTeamAttentionIds((current) => {
        if (!current.has(nextFocus.sessionId)) return current;
        const next = new Set(current);
        next.delete(nextFocus.sessionId);
        return next;
      });
    }
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
    teamSnapshotsRef.current.clear();
    mainFingerprintRef.current = null;
    decisionReturnFocusRef.current = null;
    setTeamAttentionIds(new Set());
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
    const previous = teamSnapshotsRef.current;
    const nextSnapshots = new Map<string, TeamSessionProjection>();
    const changedIds: string[] = [];
    for (const session of teamSessions) {
      nextSnapshots.set(session.id, session);
      const previousSession = previous.get(session.id);
      const latestStep = session.activity.steps.at(-1);
      const previousLatestStep = previousSession?.activity.steps.at(-1);
      const reachedMeaningfulState = Boolean(
        previousSession
        && (
          previousSession.status !== session.status
          || (
            latestStep?.type === "tool"
            && latestStep.status === "done"
            && (
              previousLatestStep?.id !== latestStep.id
              || previousLatestStep.status !== "done"
            )
          )
        )
      );
      if (
        reachedMeaningfulState
        && !(conversationFocus.kind === "team-session" && conversationFocus.sessionId === session.id)
      ) {
        changedIds.push(session.id);
      }
      if (
        previousSession === undefined
        && previous.size > 0
        && conversationFocus.kind !== "main"
      ) {
        changedIds.push(session.id);
      }
    }
    teamSnapshotsRef.current = nextSnapshots;
    if (changedIds.length > 0) {
      setTeamAttentionIds((current) => new Set([...current, ...changedIds]));
    }
  }, [conversationFocus, teamSessions]);

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
      if ((busy || runningTeamCount > 0) && shouldFollowOutputRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    observer.observe(stream);
    return () => observer.disconnect();
  }, [busy, runningTeamCount]);

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
            {conversationFocus.kind === "overview" && (
              <span className="chat-session-crumb is-current" aria-current="page">团队总览</span>
            )}
            {conversationFocus.kind === "team-session" && selectedTeamSession && (
              <span className="chat-session-crumb is-current" aria-current="page">
                {selectedTeamSession.title}
              </span>
            )}
          </nav>
        </div>

        <div className="canvas-header-right">
          {teamSessions.length > 1 && (
            <button
              type="button"
              className={`team-overview-trigger${conversationFocus.kind === "overview" ? " is-active" : ""}`}
              onClick={() => switchConversationFocus({ kind: "overview" })}
              aria-label={`打开团队总览，${teamSessions.length} 个子任务`}
            >
              <span className="team-overview-trigger-agents" aria-hidden="true">
                <i /><i /><i />
              </span>
              <span>团队</span>
              <b>{teamSessions.length}</b>
              {teamAttentionIds.size > 0 && <i className="team-overview-trigger-alert" />}
            </button>
          )}
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
                      { keepTaskGraph: false },
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
                        teamGraphTasks={activeTasks}
                        teamSessionAttentionIds={teamAttentionIds}
                        onFocusTeamSession={focusTeamSession}
                      />
                    ) : null;
                  })()}

                  {!(busy && streamingMessageId === msg.id) && (
                    <MessageMarkdown content={msg.content} className="assistant-response" />
                  )}

                  <InteractionCardHost
                    host="timeline"
                    anchorMessageId={msg.id}
                    selectedDesignSystem={selectedDesignSystem}
                    busy={busy}
                    onResolveQuestion={onResolveQuestion}
                    onConfirmLayout={onConfirmLayout}
                  />

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

                <ReviewCardHost
                  anchorMessageId={msg.id}
                  busy={busy}
                  onResolveApproval={onResolveApproval}
                  onResolvePatch={onResolvePatch}
                />

                <ArtifactCardHost
                  anchorMessageId={msg.id}
                  presentation={presentation}
                  busy={busy}
                  isExportingDeck={isExportingDeck}
                  onConfirmBrief={onConfirmBrief}
                  onConfirmOutline={onConfirmOutline}
                  onReviseOutline={onReviseOutline}
                  onOpenDeckPreview={onOpenDeckPreview}
                  onExportDeck={onExportDeck}
                />
                </>
              )}
            </div>
          );
        })}

        <InteractionCardHost
          host="timeline"
          selectedDesignSystem={selectedDesignSystem}
          busy={busy}
          onResolveQuestion={onResolveQuestion}
          onConfirmLayout={onConfirmLayout}
        />

        <ReviewCardHost
          busy={busy}
          onResolveApproval={onResolveApproval}
          onResolvePatch={onResolvePatch}
        />

        <ArtifactCardHost
          presentation={presentation}
          busy={busy}
          isExportingDeck={isExportingDeck}
          onConfirmBrief={onConfirmBrief}
          onConfirmOutline={onConfirmOutline}
          onReviseOutline={onReviseOutline}
          onOpenDeckPreview={onOpenDeckPreview}
          onExportDeck={onExportDeck}
        />

        {/* Agent 实时思考：工具调用列表 + 模型推理流 */}
        <AgentThinkingLoader
          busy={busy}
          agentActivityMode={agentActivityMode}
          activityTrace={activityTrace}
          suppressTrace={Boolean(streamingMessageId)}
          teamGraphTasks={activeTasks}
          teamSessionAttentionIds={teamAttentionIds}
          onFocusTeamSession={focusTeamSession}
        />

        {!busy && runningTeamCount > 0 && (
          <LeadWaitingState runningCount={runningTeamCount} />
        )}
          </>
        ) : conversationFocus.kind === "overview" ? (
          <TeamOverview
            sessions={teamSessions}
            attentionIds={teamAttentionIds}
            onFocus={focusTeamSession}
          />
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

        <div className={showTaskPlan && conversationFocus.kind === "main" ? "chat-input-stack" : undefined}>
          <InteractionCardHost
            host="composer-before-input"
            selectedDesignSystem={selectedDesignSystem}
            busy={busy}
            onResolveQuestion={onResolveQuestion}
            onConfirmLayout={onConfirmLayout}
          />
          {showTaskPlan && conversationFocus.kind === "main" && (
            <TaskPlanCard
              goal={planGoal}
              tasks={activeTasks}
              live={busy || hasActiveTaskPlan}
            />
          )}
          {conversationFocus.kind !== "main" && !pendingToolApproval && (
            <div className="team-focus-composer-note">
              当前为只读观察视图；这里发送的新指令仍会交给 lead。
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
            sandboxName={sandboxName}
          />
        </div>
        </div>
      </div>

    </section>
  );
};
