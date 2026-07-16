import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { AgentStreamEvent } from "@shared/ipc";
import { isTeammateProgressEvent } from "@shared/teammate-progress";
import {
  type AgentActivityItem,
  appendReasoningChunk,
  appendStep,
  appendToolApprovalWaiting,
  appendToolStart,
  appendToolSummaryChunk,
  appendToolValidationFailed,
  applyTeammateProgressEvent,
  finishTool,
  mergeActivityTraces,
  sealAllReasoning,
  updateStepText,
  upsertTaskGraphTrace,
} from "@shared/agent-activity";
import {
  formatAgentProgressMessage,
  formatAgentToolActivity,
  inferAgentToolActivityState,
} from "@shared/agent-activity-display";
import { ingestDisplayEvent } from "../../cards/display-card-managers";
import type { ChatMessage } from "../chatMessageRuntime";

export type AgentActivityMode = "idle" | "request" | "workflow" | "reasoning";

interface UseAgentActivityStreamOptions {
  activeSessionIdRef: MutableRefObject<string>;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

export interface AgentActivityStreamController {
  activityTrace: AgentActivityItem[];
  thoughtProgress: number;
  setThoughtProgress: Dispatch<SetStateAction<number>>;
  agentActivityMode: AgentActivityMode;
  setAgentActivityMode: Dispatch<SetStateAction<AgentActivityMode>>;
  activeRunIdRef: MutableRefObject<string | null>;
  activeRunTraceRef: MutableRefObject<AgentActivityItem[]>;
  streamMessageIdsRef: MutableRefObject<Map<string, string>>;
  sidechainRunRef: MutableRefObject<string | null>;
  syncActivityTrace: (next: AgentActivityItem[]) => void;
  beginRunActivity: (runId: string, messageId: string, sidechain: boolean) => void;
  finishRunActivity: (runId: string) => void;
}

export function useAgentActivityStream({
  activeSessionIdRef,
  setChatMessages,
}: UseAgentActivityStreamOptions): AgentActivityStreamController {
  const [activityTrace, setActivityTrace] = useState<AgentActivityItem[]>([]);
  const [thoughtProgress, setThoughtProgress] = useState(0);
  const [agentActivityMode, setAgentActivityMode] = useState<AgentActivityMode>("idle");
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunTraceRef = useRef<AgentActivityItem[]>([]);
  const requestStatusStepIdRef = useRef<string | null>(null);
  const streamMessageIdsRef = useRef(new Map<string, string>());
  const sidechainRunRef = useRef<string | null>(null);
  const pendingProgressTextRef = useRef("");
  const statusTypingTimerRef = useRef<number | null>(null);

  const stopStatusTyping = useCallback(() => {
    if (statusTypingTimerRef.current !== null) {
      window.clearInterval(statusTypingTimerRef.current);
      statusTypingTimerRef.current = null;
    }
  }, []);

  const syncActivityTrace = useCallback((next: AgentActivityItem[]) => {
    activeRunTraceRef.current = next;
    setActivityTrace(next);

    const runId = activeRunIdRef.current;
    if (!runId || next.length === 0) return;
    const messageId = streamMessageIdsRef.current.get(runId);
    if (!messageId) return;

    setChatMessages((current) => {
      if (!current.some((message) => message.id === messageId)) return current;
      return current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              activityTrace: mergeActivityTraces(message.activityTrace, next),
            }
          : message,
      );
    });
  }, [setChatMessages]);

  const flushPendingProgress = useCallback(() => {
    const progressText = pendingProgressTextRef.current.trim();
    if (!progressText) return;

    pendingProgressTextRef.current = "";
    syncActivityTrace(appendStep(activeRunTraceRef.current, progressText, "done"));

    const runId = activeRunIdRef.current;
    const messageId = runId ? streamMessageIdsRef.current.get(runId) : undefined;
    if (!messageId) return;
    setChatMessages((current) => current.map((message) =>
      message.id === messageId ? { ...message, content: "" } : message,
    ));
  }, [setChatMessages, syncActivityTrace]);

  useEffect(() => {
    const unsubscribe = window.desktopApi.onAgentStream((event: AgentStreamEvent) => {
      const isCurrentRun = event.runId === activeRunIdRef.current;
      if (event.type === "display-event") {
        if (event.sessionId && event.sessionId !== activeSessionIdRef.current) return;
        try {
          ingestDisplayEvent(event.event);
        } catch (error) {
          console.error("Invalid display event received:", error);
        }
        return;
      }
      if (event.type === "task-graph-updated") {
        if (event.sessionId && event.sessionId !== activeSessionIdRef.current) return;
        if (!isCurrentRun) return;
      }

      if (isTeammateProgressEvent(event)) {
        if (event.sessionId && event.sessionId !== activeSessionIdRef.current) return;
        if (isCurrentRun) {
          setAgentActivityMode(
            event.type === "teammate-thinking-chunk" ? "reasoning" : "workflow",
          );
          syncActivityTrace(applyTeammateProgressEvent(activeRunTraceRef.current, event));
        } else {
          setChatMessages((current) => current.map((message) =>
            message.role === "assistant" && message.threadId === event.runId
              ? {
                  ...message,
                  activityTrace: applyTeammateProgressEvent(
                    message.activityTrace ?? [],
                    event,
                  ),
                }
              : message,
          ));
        }
        return;
      }
      if (!isCurrentRun) return;

      if (event.type === "request-status") {
        const displayMessage = formatAgentProgressMessage(event.message);
        if (!displayMessage) return;
        stopStatusTyping();
        setAgentActivityMode("request");
        setThoughtProgress(event.progress);
        if (!requestStatusStepIdRef.current) {
          const stepId = crypto.randomUUID();
          requestStatusStepIdRef.current = stepId;
          syncActivityTrace([
            ...activeRunTraceRef.current,
            {
              id: stepId,
              kind: "step",
              text: displayMessage.slice(0, 1),
              status: "typing",
            },
          ]);
        }
        let visibleLength = 1;
        statusTypingTimerRef.current = window.setInterval(() => {
          visibleLength += 1;
          const stepId = requestStatusStepIdRef.current;
          if (stepId) {
            syncActivityTrace(
              updateStepText(
                activeRunTraceRef.current,
                stepId,
                displayMessage.slice(0, visibleLength),
              ),
            );
          }
          if (visibleLength >= displayMessage.length) stopStatusTyping();
        }, 28);
        return;
      }

      const requestStatusStepId = requestStatusStepIdRef.current;
      if (requestStatusStepId) {
        requestStatusStepIdRef.current = null;
        syncActivityTrace(activeRunTraceRef.current.map((item) =>
          item.kind === "step" && item.id === requestStatusStepId
            ? { ...item, status: "done" as const }
            : item,
        ));
      }

      if (event.type === "workflow-progress") {
        stopStatusTyping();
        flushPendingProgress();
        setAgentActivityMode("workflow");
        const displayMessage = formatAgentProgressMessage(event.message);
        if (displayMessage) {
          syncActivityTrace(appendStep(activeRunTraceRef.current, displayMessage, "done"));
        }
        setThoughtProgress(event.progress);
        return;
      }

      if (event.type === "stage-started") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        return;
      }

      if (event.type === "tool-started") {
        stopStatusTyping();
        flushPendingProgress();
        setAgentActivityMode("workflow");
        syncActivityTrace(
          appendToolStart(
            activeRunTraceRef.current,
            event.toolName,
            formatAgentToolActivity(event.toolName, "running"),
          ),
        );
        return;
      }

      if (event.type === "tool-finished") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        const state = inferAgentToolActivityState(event.message, "completed");
        syncActivityTrace(
          finishTool(
            activeRunTraceRef.current,
            event.toolName,
            formatAgentToolActivity(event.toolName, state),
          ),
        );
        return;
      }

      if (event.type === "tool-validation-failed") {
        stopStatusTyping();
        flushPendingProgress();
        setAgentActivityMode("workflow");
        syncActivityTrace(
          appendToolValidationFailed(
            activeRunTraceRef.current,
            event.toolName,
            event.error,
          ),
        );
        return;
      }

      if (event.type === "approval-waiting") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        syncActivityTrace(appendStep(activeRunTraceRef.current, "等待用户审批", "done"));
        return;
      }

      if (event.type === "tool-approval-waiting") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        syncActivityTrace(
          appendToolApprovalWaiting(activeRunTraceRef.current, {
            approvalId: event.approvalId,
            toolName: event.toolName,
            reason: event.reason,
            detail: event.detail,
          }),
        );
        return;
      }

      if (event.type === "task-graph-updated") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        syncActivityTrace(
          upsertTaskGraphTrace(activeRunTraceRef.current, {
            tasks: event.tasks,
            goal: event.goal,
          }),
        );
        return;
      }

      if (event.type === "thinking-chunk") {
        stopStatusTyping();
        const nextModelStep = event.modelStep ?? 0;
        const latestReasoning = [...activeRunTraceRef.current].reverse().find(
          (item) => item.kind === "reasoning",
        );
        if (
          pendingProgressTextRef.current.trim()
          && latestReasoning?.kind === "reasoning"
          && (latestReasoning.modelStep ?? 0) !== nextModelStep
        ) {
          flushPendingProgress();
        }
        setAgentActivityMode("reasoning");
        syncActivityTrace(
          appendReasoningChunk(
            activeRunTraceRef.current,
            event.chunk,
            nextModelStep,
          ),
        );
        return;
      }

      if (event.type === "text-chunk") {
        stopStatusTyping();
        requestStatusStepIdRef.current = null;

        if (event.source === "tool-summary") {
          syncActivityTrace(
            appendToolSummaryChunk(activeRunTraceRef.current, event.chunk),
          );
          if (!streamMessageIdsRef.current.has(event.runId)) {
            const messageId = crypto.randomUUID();
            streamMessageIdsRef.current.set(event.runId, messageId);
            const sealedTrace = sealAllReasoning(activeRunTraceRef.current);
            setChatMessages((current) => [
              ...current,
              {
                id: messageId,
                role: "assistant",
                content: "",
                activityTrace: sealedTrace.length > 0 ? sealedTrace : undefined,
              },
            ]);
          }
          return;
        }

        const sealedTrace = sealAllReasoning(activeRunTraceRef.current);
        activeRunTraceRef.current = sealedTrace;
        setActivityTrace(sealedTrace);
        let messageId = streamMessageIdsRef.current.get(event.runId);
        pendingProgressTextRef.current += event.chunk;
        if (!messageId) {
          messageId = crypto.randomUUID();
          streamMessageIdsRef.current.set(event.runId, messageId);
          setChatMessages((current) => [
            ...current,
            {
              id: messageId!,
              role: "assistant",
              content: event.chunk,
              activityTrace: sealedTrace.length > 0 ? sealedTrace : undefined,
            },
          ]);
        } else {
          setChatMessages((current) => current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  content: message.content + event.chunk,
                  activityTrace: mergeActivityTraces(message.activityTrace, sealedTrace),
                }
              : message,
          ));
        }
      }
    });
    return () => {
      stopStatusTyping();
      unsubscribe();
    };
  }, [
    activeSessionIdRef,
    flushPendingProgress,
    setChatMessages,
    stopStatusTyping,
    syncActivityTrace,
  ]);

  const beginRunActivity = useCallback((
    runId: string,
    messageId: string,
    sidechain: boolean,
  ) => {
    syncActivityTrace([]);
    setThoughtProgress(0);
    setAgentActivityMode("request");
    activeRunIdRef.current = runId;
    activeRunTraceRef.current = [];
    pendingProgressTextRef.current = "";
    requestStatusStepIdRef.current = null;
    streamMessageIdsRef.current.set(runId, messageId);
    sidechainRunRef.current = sidechain ? runId : null;
  }, [syncActivityTrace]);

  const finishRunActivity = useCallback((runId: string) => {
    if (sidechainRunRef.current === runId) sidechainRunRef.current = null;
    activeRunIdRef.current = null;
    streamMessageIdsRef.current.delete(runId);
    stopStatusTyping();
    setAgentActivityMode("idle");
    syncActivityTrace([]);
    setThoughtProgress(0);
    requestStatusStepIdRef.current = null;
    activeRunTraceRef.current = [];
    pendingProgressTextRef.current = "";
  }, [stopStatusTyping, syncActivityTrace]);

  return {
    activityTrace,
    thoughtProgress,
    setThoughtProgress,
    agentActivityMode,
    setAgentActivityMode,
    activeRunIdRef,
    activeRunTraceRef,
    streamMessageIdsRef,
    sidechainRunRef,
    syncActivityTrace,
    beginRunActivity,
    finishRunActivity,
  };
}
