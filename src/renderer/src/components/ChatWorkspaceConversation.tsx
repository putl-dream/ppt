import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { collectTeamSessions } from "@shared/team-session";
import { useProgressCardManager } from "../cards/display-card-managers";
import { CHAT_WORKSPACE_COPY_ZH_CN as copy } from "./chat-workspace-copy";
import { ChatMessageStream } from "./ChatMessageStream";
import { ChatWorkspaceComposer } from "./ChatWorkspaceComposer";
import { ChevronRightIcon, OpenPreviewIcon } from "./Icons";
import type {
  ChatWorkspaceActions,
  ChatWorkspaceComposer as ComposerState,
  ChatWorkspaceDeck,
  ChatWorkspaceInputRuntime,
  ChatWorkspaceRun,
  ChatWorkspaceSession,
} from "./chat-workspace-types";
import { useChatScroll } from "./useChatScroll";

type ConversationFocus =
  | { kind: "main" }
  | { kind: "team-session"; sessionId: string };

function focusKey(focus: ConversationFocus): string {
  return focus.kind === "team-session" ? `team:${focus.sessionId}` : focus.kind;
}

interface ChatWorkspaceConversationProps {
  title: string;
  session: ChatWorkspaceSession;
  run: ChatWorkspaceRun;
  composer: ComposerState;
  deck: ChatWorkspaceDeck;
  actions: ChatWorkspaceActions;
  inputRuntime: ChatWorkspaceInputRuntime;
}

export function ChatWorkspaceConversation({
  title,
  session,
  run,
  composer,
  deck,
  actions,
  inputRuntime,
}: ChatWorkspaceConversationProps): ReactNode {
  const chatScroll = useChatScroll();
  const [conversationFocus, setConversationFocus] = useState<ConversationFocus>({ kind: "main" });
  const [mainHasAttention, setMainHasAttention] = useState(false);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const pendingScrollRestoreRef = useRef<string | null>(null);
  const mainFingerprintRef = useRef<string | null>(null);
  const decisionReturnFocusRef = useRef<ConversationFocus | null>(null);
  const hadPendingDecisionRef = useRef(false);
  const sessionIdentityRef = useRef<string | null>(null);

  const managedProgressCards = useProgressCardManager((state) => state.cards);
  const managedTaskList = [...managedProgressCards].reverse().find((card) =>
    card.status === "active"
    && card.event.kind === "progress.task-list-updated"
    && (!run.activeRunId || card.event.scope.runId === run.activeRunId)
  );
  const managedTaskListPayload = managedTaskList?.event.kind === "progress.task-list-updated"
    ? managedTaskList.event.payload
    : undefined;
  const latestPlan = managedTaskListPayload
    ? {
        tasks: [...managedTaskListPayload.tasks],
        goal: managedTaskListPayload.goal ?? null,
        state: managedTaskListPayload.state,
        archive: managedTaskListPayload.archive,
      }
    : null;
  const activeTasks = latestPlan?.tasks ?? [];
  const sessionGoal = session.messages.find((message) => message.role === "user")?.content.trim() || null;
  const planGoal = latestPlan ? latestPlan.goal : sessionGoal;
  const teamSessions = useMemo(() => collectTeamSessions(
    [
      ...session.messages.map((message) => message.activityTrace),
      run.activityTrace,
    ],
    activeTasks,
  ), [activeTasks, run.activityTrace, session.messages]);
  const selectedTeamSession = conversationFocus.kind === "team-session"
    ? teamSessions.find((teamSession) => teamSession.id === conversationFocus.sessionId)
    : undefined;
  const currentFocusKey = focusKey(conversationFocus);
  const sessionIdentity = session.messages[0]?.id ?? `empty:${title}`;
  const mainFingerprint = useMemo(() => {
    const lastMessage = session.messages.at(-1);
    const leadTrace = run.activityTrace.filter(
      (item) => item.kind !== "task" && item.kind !== "tasklist",
    );
    const lastLeadItem = leadTrace.at(-1);
    return [
      lastMessage?.id ?? "",
      lastMessage?.content.length ?? 0,
      run.busy ? "busy" : "idle",
      leadTrace.length,
      lastLeadItem?.id ?? "",
      lastLeadItem?.kind ?? "",
    ].join(":");
  }, [run.activityTrace, run.busy, session.messages]);

  const switchConversationFocus = useCallback((nextFocus: ConversationFocus) => {
    scrollPositionsRef.current.set(currentFocusKey, chatScroll.getScrollTop());
    pendingScrollRestoreRef.current = focusKey(nextFocus);
    chatScroll.setFollowing(false);
    setConversationFocus(nextFocus);
    if (nextFocus.kind === "main") setMainHasAttention(false);
  }, [chatScroll, currentFocusKey]);

  const focusTeamSession = useCallback((sessionId: string) => {
    switchConversationFocus({ kind: "team-session", sessionId });
  }, [switchConversationFocus]);

  const openPendingDecision = useCallback(() => {
    if (!inputRuntime.pendingToolApproval) return;
    if (conversationFocus.kind !== "main") decisionReturnFocusRef.current = conversationFocus;
    switchConversationFocus({ kind: "main" });
    window.requestAnimationFrame(() => {
      chatScroll.setFollowing(true);
      chatScroll.scrollToBottom();
    });
  }, [chatScroll, conversationFocus, inputRuntime.pendingToolApproval, switchConversationFocus]);

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
    chatScroll.setFollowing(true);
  }, [chatScroll, sessionIdentity]);

  useEffect(() => {
    if (
      conversationFocus.kind === "team-session"
      && !teamSessions.some((teamSession) => teamSession.id === conversationFocus.sessionId)
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
    const pending = Boolean(inputRuntime.pendingToolApproval);
    if (hadPendingDecisionRef.current && !pending && decisionReturnFocusRef.current) {
      const returnFocus = decisionReturnFocusRef.current;
      decisionReturnFocusRef.current = null;
      switchConversationFocus(returnFocus);
    }
    hadPendingDecisionRef.current = pending;
  }, [inputRuntime.pendingToolApproval, switchConversationFocus]);

  useLayoutEffect(() => {
    if (pendingScrollRestoreRef.current !== currentFocusKey) return;
    chatScroll.setScrollTop(scrollPositionsRef.current.get(currentFocusKey) ?? 0);
    pendingScrollRestoreRef.current = null;
  }, [chatScroll, currentFocusKey]);

  useLayoutEffect(() => {
    chatScroll.stickToBottomIfFollowing();
  }, [chatScroll, run.activityTrace, run.busy, run.phase, session.messages]);

  useLayoutEffect(() => chatScroll.bind(), [chatScroll, run.busy]);

  return (
    <section className="canvas-column chat-workspace-column view-enter">
      <div className="panel-header canvas-header">
        <div className="canvas-header-left">
          <nav className="chat-session-breadcrumb" aria-label={copy.taskFocusAria}>
            <button
              type="button"
              className={`chat-session-crumb${conversationFocus.kind === "main" ? " is-current" : ""}`}
              onClick={() => switchConversationFocus({ kind: "main" })}
              title={title}
              aria-current={conversationFocus.kind === "main" ? "page" : undefined}
            >
              <span>{title}</span>
              {mainHasAttention && (
                <i className="chat-session-attention-dot" aria-label={copy.mainTaskAttentionAria} />
              )}
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
          {inputRuntime.pendingToolApproval && (
            <button
              type="button"
              className="team-decision-alert"
              onClick={openPendingDecision}
              aria-label={copy.approvalAria(inputRuntime.pendingToolApproval.reason)}
              title={copy.approvalJumpTitle}
            >
              <span className="team-decision-alert-icon" aria-hidden="true">!</span>
              <span>{copy.approvalRequired}</span>
              <b>1</b>
            </button>
          )}
          {!deck.isMirrorOpen && (
            <button
              className="action-icon-btn focus-toggle-btn"
              onClick={deck.onToggleMirror}
              aria-label={copy.openPreview}
              title={copy.openPreview}
            >
              <OpenPreviewIcon size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="chat-scroll-viewport" ref={chatScroll.viewportRef}>
        <div className="chat-conversation-shell">
          <div className="chat-stream" ref={chatScroll.streamRef}>
            <ChatMessageStream
              session={session}
              run={run}
              deck={deck}
              actions={actions}
              activeTasks={activeTasks}
              planGoal={planGoal}
              planState={latestPlan?.state}
              planArchive={latestPlan?.archive}
              teamSessions={teamSessions}
              selectedTeamSession={selectedTeamSession}
              showMainConversation={conversationFocus.kind === "main"}
              onOpenTask={focusTeamSession}
            />
            <div />
          </div>
        </div>
      </div>

      <ChatWorkspaceComposer
        composer={composer}
        run={run}
        deck={deck}
        actions={actions}
        inputRuntime={inputRuntime}
        viewingTeamSession={conversationFocus.kind !== "main"}
      />
    </section>
  );
}
