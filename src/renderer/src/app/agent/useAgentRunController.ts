import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AgentRunRequest } from "@shared/ipc";
import { createDisplayEventId } from "@shared/card-display-protocol";
import type { Presentation } from "@shared/presentation";
import { createSessionTitleFromPrompt, type SessionBootstrap } from "@shared/session";
import type { LayoutChoice } from "@shared/layout-preference";
import type { LeanGenerationMode } from "@shared/lean-mode-contract";
import {
  appendStep,
  resolveToolApprovalItem,
} from "@shared/agent-activity";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import { toAgentModelSettings } from "../../modelCatalog";
import { buildAgentGatewayConfig } from "../../agentGatewayConfig";
import { useProjectStore } from "../../components/project-store";
import {
  getPersistedDisplayCards,
  ingestDisplayEvent,
  pruneDisplayCardsForMessages,
  setDisplayCardStatus,
  usePermissionCardManager,
} from "../../cards/display-card-managers";
import {
  findActiveThreadId,
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

const PREVIEW_PROMPT_PATTERN =
  /预览.*(?:ppt|幻灯片|演示文稿)|(?:ppt|幻灯片|演示文稿).*预览|打开.*预览/i;

const isPreviewPrompt = (prompt: string) => PREVIEW_PROMPT_PATTERN.test(prompt.trim());

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

    if (presentation && isPreviewPrompt(activeRequest)) {
      setChatMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: activeRequest },
      ]);
      if (!customRequest) setRequest("");
      openDeckPreview();
      const previewMessageId = crypto.randomUUID();
      ingestDisplayEvent({
        protocolVersion: 1,
        eventId: createDisplayEventId("artifact-preview"),
        emittedAt: new Date().toISOString(),
        kind: "artifact.ready",
        category: "artifact",
        source: {
          kind: "frontend",
          feature: "deck-preview-command",
        },
        scope: {
          ...(activeSessionId ? { sessionId: activeSessionId } : {}),
          anchorMessageId: previewMessageId,
        },
        semantics: {
          blocking: false,
          requiresResponse: false,
          priority: "normal",
        },
        payload: {
          artifactId: "deck",
          artifactType: "deck",
          title: presentation.title,
          revision: presentation.revision,
        },
      });
      setChatMessages((current) => [
        ...current,
        {
          id: previewMessageId,
          role: "assistant",
          content: "已打开演示文稿预览，你可以在右侧或弹窗中查看全部页面。",
        },
      ]);
      notify("已打开演示文稿预览");
      return;
    }

    setBusy(true);
    setIsDraftChat(false);
    let agentSessionId = activeSessionId;

    if (!agentSessionId) {
      try {
        const sessionTitle = createSessionTitleFromPrompt(activeRequest);
        const state = await window.desktopApi.createSession(
          localStoragePath
            ? { rootPath: localStoragePath, title: sessionTitle }
            : { title: sessionTitle },
        );
        applySessionState(state);
        setIsDraftChat(false);
        agentSessionId = state.activeSession!.session.id;
      } catch (error) {
        setBusy(false);
        setIsDraftChat(true);
        notify(formatPublicErrorMessage(error, "创建会话失败，请重试。"));
        return;
      }
    }

    const activeProject = useProjectStore.getState().activeProject;
    if (!agentSessionId || !activeProject) {
      setBusy(false);
      notify("项目会话尚未准备好，请稍后再试");
      return;
    }

    const agentRequest: AgentRunRequest = {
      prompt: activeRequest,
      sessionId: agentSessionId,
      editorContext: { selectedElementIds: [] },
      generationMode: runGenerationMode,
      ...(options?.layoutChoice ? { layoutChoice: options.layoutChoice } : {}),
    };

    console.info("Starting unified Agent run", {
      sessionId: agentRequest.sessionId,
      editorContext: agentRequest.editorContext,
      generationMode: runGenerationMode,
    });

    const runId = crypto.randomUUID();
    const streamMessageId = crypto.randomUUID();
    setActiveRunId(runId);
    beginRunActivity(runId, streamMessageId, isSidechain);
    let forkedMessages: ChatMessage[] | undefined;
    const streamPlaceholder: ChatMessage = {
      id: streamMessageId,
      role: "assistant",
      content: "",
      threadId: runId,
    };
    let runMessages: ChatMessage[];

    if (isSidechain) {
      runMessages = [...sourceMessages, streamPlaceholder];
      setChatMessages(runMessages);
    } else if (isEditOfMsgId) {
      const index = sourceMessages.findIndex((message) => message.id === isEditOfMsgId);
      if (index !== -1) {
        forkedMessages = sourceMessages.slice(0, index + 1);
        forkedMessages[index] = {
          ...forkedMessages[index],
          id: crypto.randomUUID(),
          content: userDisplayContent ?? activeRequest,
        };
        pruneDisplayCardsForMessages(new Set(forkedMessages.map((message) => message.id)));
        runMessages = [...forkedMessages, streamPlaceholder];
      } else {
        runMessages = [...sourceMessages, streamPlaceholder];
      }
      setChatMessages(runMessages);
    } else if (userDisplayContent !== null) {
      runMessages = [
        ...sourceMessages,
        { id: crypto.randomUUID(), role: "user", content: userDisplayContent },
        streamPlaceholder,
      ];
      setChatMessages(runMessages);
    } else {
      runMessages = [...sourceMessages, streamPlaceholder];
      setChatMessages(runMessages);
    }

    if (!customRequest) setRequest("");

    try {
      if (!isSidechain) {
        await window.desktopApi.saveSessionMessages(
          agentSessionId,
          toSessionChatMessages(runMessages),
        );
      }
      const gatewayConfig = buildAgentGatewayConfig(agentGatewayPreferences, enabledModels);
      const modelSettings = selectedModel ? toAgentModelSettings(selectedModel) : undefined;
      const activeThreadId = findActiveThreadId(
        forkedMessages ?? sourceMessages,
        getPersistedDisplayCards(),
      );
      const result = runGenerationMode === "agent" && activeThreadId
        ? await window.desktopApi.continueAgentRun(
            activeThreadId,
            agentRequest,
            modelSettings,
            agentStepLimits,
            gatewayConfig,
            runId,
          )
        : await window.desktopApi.startAgentRun(
            agentRequest,
            modelSettings,
            "REQUEST_APPROVAL",
            agentStepLimits,
            gatewayConfig,
            runId,
          );
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
