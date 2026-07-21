import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SessionBootstrap } from "@shared/session";
import type { LayoutChoice } from "@shared/layout-preference";
import type { LeanGenerationMode } from "@shared/lean-mode-contract";
import {
  appendStep,
  resolveToolApprovalItem,
} from "@shared/agent-activity";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import {
  coordinateAgentRun,
  createAgentRunLock,
  type AgentRunContext,
} from "@shared/agent-run-lifecycle";
import {
  pruneDisplayCardsForMessages,
  setDisplayCardStatus,
  usePermissionCardManager,
} from "../../cards/display-card-managers";
import {
  toSessionChatMessages,
  type ChatMessage,
} from "../chatMessageRuntime";
import type { SettingsController } from "../useSettingsController";
import { useInboxPoller } from "../useInboxPoller";
import type { PresentationController } from "../presentation/usePresentationController";
import type { AgentActivityStreamController } from "./useAgentActivityStream";
import {
  useAgentResultHandler,
  type ApplyAgentResult,
} from "./useAgentResultHandler";
import { handleAgentRunFailure } from "./agentRunFailure";
import { executeAgentRun } from "./agentRunExecution";
import {
  buildAgentRunRequest,
  prepareAgentRunMessages,
} from "./agentRunPreparation";
import { prepareAgentContext } from "./agentSessionPreparation";

interface StartAgentOptions {
  userDisplayContent?: string | false;
  layoutChoice?: LayoutChoice;
  sidechain?: boolean;
  generationMode?: LeanGenerationMode;
}

interface UseAgentRunControllerOptions {
  request: string;
  setRequest: Dispatch<SetStateAction<string>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  activeSessionId: string;
  sessionLoaded: boolean;
  localStoragePath: string;
  generationMode: LeanGenerationMode;
  chatMessages: ChatMessage[];
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsDraftChat: Dispatch<SetStateAction<boolean>>;
  applySessionState: (state: SessionBootstrap) => void;
  syncPresentation: PresentationController["syncPresentation"];
  settings: Pick<
    SettingsController,
    | "agentStepLimits"
    | "agentGatewayPreferences"
    | "enabledModels"
    | "selectedModel"
  >;
  activity: AgentActivityStreamController;
  notify: (message: string) => void;
}

export interface AgentRunController {
  activeRunId: string | null;
  streamingMessageId: string | null;
  isCancellingRun: boolean;
  startAgent: (
    customRequest?: string,
    isEditOfMsgId?: string,
    options?: StartAgentOptions,
  ) => Promise<void>;
  applyAgentResult: ApplyAgentResult;
  cancelRun: () => Promise<void>;
  retryMessage: (messageId: string) => void;
  suggestPrompt: (prompt: string) => void;
  resolveToolApproval: (approvalId: string, approved: boolean) => Promise<void>;
}

export function useAgentRunController({
  request,
  setRequest,
  busy,
  setBusy,
  activeSessionId,
  sessionLoaded,
  localStoragePath,
  generationMode,
  chatMessages,
  setChatMessages,
  setIsDraftChat,
  applySessionState,
  syncPresentation,
  settings,
  activity,
  notify,
}: UseAgentRunControllerOptions): AgentRunController {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isCancellingRun, setIsCancellingRun] = useState(false);
  const {
    activeRunIdRef,
    activeRunTraceRef,
    streamMessageIdsRef,
    syncActivityTrace,
    beginRunActivity,
    finishRunActivity,
    waitForRunStreamCompletion,
  } = activity;
  const {
    agentStepLimits,
    agentGatewayPreferences,
    enabledModels,
    selectedModel,
  } = settings;
  const runLockRef = useRef(createAgentRunLock());

  const applyAgentResult = useAgentResultHandler({
    activeSessionId,
    setChatMessages,
    syncPresentation,
    activity,
    notify,
  });

  /**
   * 用户 query 的 Renderer 用例入口，仅负责编排各阶段和维护一次运行的生命周期。
   * 调用方应确保输入确实需要 Agent 处理；会话准备、消息构造、执行分流分别由
   * 独立模块负责。最终 Presentation 由 applyAgentResult 从主进程回读。
   */
  const startAgent = useCallback(async (
    customRequest?: string,
    isEditOfMsgId?: string,
    options?: StartAgentOptions,
  ) => {
    const activeRequest = customRequest || request;
    if (!activeRequest.trim() || busy) return;

    const runId = crypto.randomUUID();
    const runLock = runLockRef.current;
    if (!runLock.acquire(runId)) return;

    const runGenerationMode = options?.generationMode ?? generationMode;

    const userDisplayContent = options?.userDisplayContent === false
      ? null
      : typeof options?.userDisplayContent === "string"
        ? options.userDisplayContent
        : activeRequest;
    const isSidechain = options?.sidechain === true;
    const sourceMessages = chatMessages;
    const streamMessageId = crypto.randomUUID();
    let activityStarted = false;

    setBusy(true);
    await coordinateAgentRun({
      prepareContext: async (): Promise<AgentRunContext | undefined> => {
        const preparedContext = await prepareAgentContext({
          activeSessionId,
          prompt: activeRequest,
          localStoragePath,
          applySessionState,
          setIsDraftChat,
          notify,
        });
        return preparedContext
          ? {
              ...preparedContext,
              runId,
              streamMessageId,
              sidechain: isSidechain,
            }
          : undefined;
      },
      execute: async (context) => {
        const agentRequest = buildAgentRunRequest({
          prompt: activeRequest,
          sessionId: context.sessionId,
          generationMode: runGenerationMode,
          layoutChoice: options?.layoutChoice,
        });

        console.info("Starting unified Agent run", {
          sessionId: agentRequest.sessionId,
          editorContext: agentRequest.editorContext,
          generationMode: runGenerationMode,
        });

        setActiveRunId(context.runId);
        activityStarted = true;
        // 先注册 activity 和空助手消息，流式事件到达时才有稳定的 run/message 锚点。
        beginRunActivity(context.runId, context.streamMessageId, context.sidechain);
        const streamPlaceholder: ChatMessage = {
          id: context.streamMessageId,
          role: "assistant",
          content: "",
          threadId: context.runId,
        };
        const preparedMessages = prepareAgentRunMessages({
          sourceMessages,
          activeRequest,
          userDisplayContent,
          isSidechain: context.sidechain,
          editedMessageId: isEditOfMsgId,
          streamPlaceholder,
          createMessageId: () => crypto.randomUUID(),
        });
        if (preparedMessages.retainedMessageIds) {
          pruneDisplayCardsForMessages(preparedMessages.retainedMessageIds);
        }
        setChatMessages(preparedMessages.runMessages);
        if (!customRequest) setRequest("");

        if (!context.sidechain) {
          await window.desktopApi.saveSessionMessages(
            context.sessionId,
            toSessionChatMessages(preparedMessages.runMessages),
          );
        }
        return executeAgentRun({
          request: agentRequest,
          generationMode: runGenerationMode,
          sourceMessages,
          forkedMessages: preparedMessages.forkedMessages,
          gatewayPreferences: agentGatewayPreferences,
          enabledModels,
          selectedModel,
          stepLimits: agentStepLimits,
          runId: context.runId,
        });
      },
      finalize: async (context, result) => {
        await waitForRunStreamCompletion(context.runId);
        await applyAgentResult(result, activeRunTraceRef.current, context.runId);
      },
      handleFailure: (error, context) => {
        handleAgentRunFailure({
          error,
          isSidechain: context?.sidechain ?? isSidechain,
          runMessageId: streamMessageIdsRef.current.get(runId),
          activeTrace: activeRunTraceRef.current,
          setChatMessages,
          notify,
        });
      },
      cleanup: () => {
        if (activityStarted) finishRunActivity(runId);
        setActiveRunId((current) => current === runId ? null : current);
        setIsCancellingRun(false);
        if (runLock.release(runId)) setBusy(false);
      },
    });
  }, [
    activeRunTraceRef,
    activeSessionId,
    agentGatewayPreferences,
    agentStepLimits,
    applyAgentResult,
    applySessionState,
    beginRunActivity,
    busy,
    chatMessages,
    enabledModels,
    finishRunActivity,
    generationMode,
    localStoragePath,
    notify,
    request,
    selectedModel,
    setBusy,
    setChatMessages,
    setIsDraftChat,
    setRequest,
    streamMessageIdsRef,
    waitForRunStreamCompletion,
  ]);

  useInboxPoller({
    activeSessionId,
    sessionLoaded,
    busy,
    onInboxTurn: (prompt) => startAgent(
      prompt,
      undefined,
      { userDisplayContent: false, sidechain: true, generationMode: "agent" },
    ),
    onError: (error) => {
      console.error("轮询队友收件箱失败:", error);
    },
  });

  const cancelRun = useCallback(async () => {
    if (!activeRunIdRef.current || isCancellingRun) return;

    setIsCancellingRun(true);
    syncActivityTrace(
      appendStep(activeRunTraceRef.current, "正在中断当前会话…", "running"),
    );

    try {
      let cancelled = await window.desktopApi.cancelAgentRun(activeRunIdRef.current);
      if (!cancelled && activeSessionId) {
        cancelled = await window.desktopApi.cancelAgentSession(activeSessionId);
      }
      if (cancelled) {
        notify("正在中断会话…");
      } else {
        setIsCancellingRun(false);
        syncActivityTrace(
          appendStep(activeRunTraceRef.current, "中断请求未能送达，请稍后重试", "done"),
        );
        notify("当前没有可中断的任务");
      }
    } catch (error) {
      setIsCancellingRun(false);
      notify(formatPublicErrorMessage(error, "中断会话失败，请重试。"));
    }
  }, [
    activeRunIdRef,
    activeRunTraceRef,
    activeSessionId,
    isCancellingRun,
    notify,
    syncActivityTrace,
  ]);

  const retryMessage = useCallback((messageId: string) => {
    const index = chatMessages.findIndex((message) => message.id === messageId);
    if (index === -1) return;
    const priorUserMessage = chatMessages
      .slice(0, index)
      .reverse()
      .find((message) => message.role === "user");
    if (priorUserMessage) void startAgent(priorUserMessage.content);
  }, [chatMessages, startAgent]);

  const suggestPrompt = useCallback((prompt: string) => {
    setRequest(prompt);
    void startAgent(prompt);
  }, [setRequest, startAgent]);

  const resolveToolApproval = useCallback(async (
    approvalId: string,
    approved: boolean,
  ) => {
    const runId = activeRunIdRef.current;
    if (!runId || !busy) return;
    syncActivityTrace(
      resolveToolApprovalItem(
        activeRunTraceRef.current,
        approvalId,
        approved ? "approved" : "denied",
      ),
    );
    const permissionCard = usePermissionCardManager.getState().cards.find((card) =>
      card.status === "active"
      && card.event.kind === "permission.tool-requested"
      && card.event.payload.approvalId === approvalId
    );
    if (permissionCard) {
      setDisplayCardStatus(
        permissionCard.event.eventId,
        approved ? "resolved" : "dismissed",
      );
    }
    await window.desktopApi.resolveToolApproval(runId, approvalId, approved);
  }, [activeRunIdRef, activeRunTraceRef, busy, syncActivityTrace]);

  const streamingMessageId =
    busy && activeRunId
      ? streamMessageIdsRef.current.get(activeRunId) ?? null
      : null;

  return {
    activeRunId,
    streamingMessageId,
    isCancellingRun,
    startAgent,
    applyAgentResult,
    cancelRun,
    retryMessage,
    suggestPrompt,
    resolveToolApproval,
  };
}
