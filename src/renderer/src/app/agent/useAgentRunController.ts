import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Presentation } from "@shared/presentation";
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
import { tryHandleLocalAgentCommand } from "./agentLocalCommand";
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
  presentation: Presentation | undefined;
  openDeckPreview: PresentationController["openDeckPreview"];
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
  presentation,
  openDeckPreview,
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
   * 用户 query 的 Renderer 总入口：确保会话存在，组装 AgentRunRequest、模型和网关配置，
   * 再根据是否存在可继续的 thread 调用 startAgentRun 或 continueAgentRun。
   * 返回值只描述运行结果；最终 Presentation 会由 applyAgentResult 另行回读同步。
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

    const handledLocally = tryHandleLocalAgentCommand({
      prompt: activeRequest,
      presentation,
      sessionId: activeSessionId,
      clearRequest: !customRequest,
      appendChatMessage: (message) => {
        setChatMessages((current) => [...current, message]);
      },
      onClearRequest: () => setRequest(""),
      openDeckPreview,
      notify,
    });
    if (handledLocally) return;

    setBusy(true);
    setIsDraftChat(false);
    const agentSessionId = await ensureAgentSession({
      activeSessionId,
      prompt: activeRequest,
      localStoragePath,
      applySessionState,
      setIsDraftChat,
      notify,
    });

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
      pruneDisplayCardsForMessages(preparedMessages.retainedMessageIds);
    }
    setChatMessages(preparedMessages.runMessages);

    if (!customRequest) setRequest("");

    try {
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
    openDeckPreview,
    presentation,
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
