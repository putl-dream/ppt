import {
  useCallback,
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
import { useProjectStore } from "../../components/project-store";
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
import { ensureAgentSession } from "./agentSessionPreparation";

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
  } = activity;
  const {
    agentStepLimits,
    agentGatewayPreferences,
    enabledModels,
    selectedModel,
  } = settings;

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
    const runGenerationMode = options?.generationMode ?? generationMode;

    const userDisplayContent = options?.userDisplayContent === false
      ? null
      : typeof options?.userDisplayContent === "string"
        ? options.userDisplayContent
        : activeRequest;
    const isSidechain = options?.sidechain === true;
    const sourceMessages = chatMessages;

    setBusy(true);
    setIsDraftChat(false);
    // AgentRunRequest 强制要求 sessionId，因此先完成会话持久化，再构造运行上下文。
    const agentSessionId = await ensureAgentSession({
      activeSessionId,
      prompt: activeRequest,
      localStoragePath,
      applySessionState,
      setIsDraftChat,
      notify,
    });

    // applySessionState 可能刚刚激活项目，必须在会话准备完成后读取最新 store 状态。
    const activeProject = useProjectStore.getState().activeProject;
    if (!agentSessionId || !activeProject) {
      setBusy(false);
      notify("项目会话尚未准备好，请稍后再试");
      return;
    }

    const agentRequest = buildAgentRunRequest({
      prompt: activeRequest,
      sessionId: agentSessionId,
      generationMode: runGenerationMode,
      layoutChoice: options?.layoutChoice,
    });

    console.info("Starting unified Agent run", {
      sessionId: agentRequest.sessionId,
      editorContext: agentRequest.editorContext,
      generationMode: runGenerationMode,
    });

    const runId = crypto.randomUUID();
    const streamMessageId = crypto.randomUUID();
    setActiveRunId(runId);
    // 先注册 activity 和空助手消息，流式事件到达时才有稳定的 run/message 锚点。
    beginRunActivity(runId, streamMessageId, isSidechain);
    const streamPlaceholder: ChatMessage = {
      id: streamMessageId,
      role: "assistant",
      content: "",
      threadId: runId,
    };
    const preparedMessages = prepareAgentRunMessages({
      sourceMessages,
      activeRequest,
      userDisplayContent,
      isSidechain,
      editedMessageId: isEditOfMsgId,
      streamPlaceholder,
      createMessageId: () => crypto.randomUUID(),
    });
    if (preparedMessages.retainedMessageIds) {
      // 编辑重发会截断旧分支；同步移除不再有消息锚点的 Display Card。
      pruneDisplayCardsForMessages(preparedMessages.retainedMessageIds);
    }
    setChatMessages(preparedMessages.runMessages);

    if (!customRequest) setRequest("");

    try {
      // sidechain 是后台协作回合，不覆盖用户当前可见会话的持久化消息。
      if (!isSidechain) {
        await window.desktopApi.saveSessionMessages(
          agentSessionId,
          toSessionChatMessages(preparedMessages.runMessages),
        );
      }
      const result = await executeAgentRun({
        request: agentRequest,
        generationMode: runGenerationMode,
        sourceMessages,
        forkedMessages: preparedMessages.forkedMessages,
        gatewayPreferences: agentGatewayPreferences,
        enabledModels,
        selectedModel,
        stepLimits: agentStepLimits,
        runId,
      });
      // 让本轮最后一批 stream state 先提交，再用最终结果收口消息和 Presentation。
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      await applyAgentResult(result, activeRunTraceRef.current, runId);
    } catch (error) {
      handleAgentRunFailure({
        error,
        isSidechain,
        runMessageId: streamMessageIdsRef.current.get(runId),
        activeTrace: activeRunTraceRef.current,
        setChatMessages,
        notify,
      });
    } finally {
      // 运行生命周期由入口统一收口，所有执行路径都必须解除 busy/activity 状态。
      setActiveRunId(null);
      setIsCancellingRun(false);
      setBusy(false);
      finishRunActivity(runId);
    }
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
