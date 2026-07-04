import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentApprovalRequest,
  AgentRunRequest,
  AgentRunResult,
  AgentStreamEvent,
} from "@shared/ipc";
import type { Presentation, SlideElement } from "@shared/presentation";
import {
  createWelcomeMessage,
  type SessionBootstrap,
  type SessionChatMessage,
  type SessionSummary,
} from "@shared/session";
import { LeftPanel } from "./components/LeftPanel";
import { SettingsSidebar } from "./components/SettingsSidebar";
import { SettingsConsole } from "./components/SettingsConsole";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { PPTMirror } from "./components/PPTMirror";
import { DeckPreviewModal } from "./components/DeckPreviewModal";

import { useProjectStore, type ActiveProject } from "./components/project-store";
import { getWorkspaceLabel, normalizeWorkspacePath, resolveWorkspacePath } from "@shared/workspace";
import {
  artifactStageToInlineCardType,
  isExportPrompt,
  isPreviewPrompt,
  mergeInlineCardRefs,
  parseBriefForCard,
  parseOutlineForCard,
  resolveMessageInlineCards,
  type InlineCardRef,
} from "@shared/inline-artifact-cards";
import {
  buildLayoutPhasePrompt,
  saveLayoutVisualMode,
  type LayoutVisualMode,
} from "@shared/layout-preference";
import {
  countSlidesNeedingLayout,
  presentationNeedsLayoutChoice,
} from "@shared/presentation-draft";
import { findRecoverableConversation } from "@shared/session-recovery";
import {
  DEFAULT_MODELS,
  MODEL_STORAGE_KEY,
  SELECTED_MODEL_STORAGE_KEY,
  loadManagedModels,
  toAgentModelSettings,
  type ManagedModel,
} from "./modelCatalog";
import { loadAgentStepLimits, saveAgentStepLimits } from "./agentStepLimits";
import {
  buildAgentGatewayConfig,
  loadAgentGatewayPreferences,
  saveAgentGatewayPreferences,
} from "./agentGatewayConfig";
import type { AgentGatewayPreferences } from "@shared/agent-gateway-config";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import {
  type AgentActivityItem,
  appendReasoningChunk,
  appendStep,
  appendToolValidationFailed,
  appendToolStart,
  appendToolSummaryChunk,
  appendToolApprovalWaiting,
  resolveToolApprovalItem,
  finishTool,
  markTraceComplete,
  mergeActivityTraces,
  sealAllReasoning,
  updateStepText,
  upsertTodoTrace,
  upsertTaskStarted,
  appendTaskReasoningChunk,
  appendTaskToolStart,
  finishTaskTool,
  finishTask,
} from "@shared/agent-activity";

type ChatMessage = SessionChatMessage;

function findActiveThreadId(messages: ChatMessage[]): string | undefined {
  return findRecoverableConversation(messages)?.threadId;
}

function toSessionChatMessages(messages: ChatMessage[]): SessionChatMessage[] {
  return messages.map(({
    id,
    role,
    content,
    thought,
    reasoning,
    activityTrace,
    progress,
    approval,
    patch,
    inlineCards,
    threadId,
  }) => ({
    id,
    role,
    content,
    thought,
    reasoning,
    activityTrace,
    progress,
    approval,
    patch,
    inlineCards,
    threadId,
  }));
}

function attachInlineCards(
  message: ChatMessage,
  additions: Array<"brief" | "outline" | "layout" | "deck">,
): ChatMessage {
  return {
    ...message,
    inlineCards: mergeInlineCardRefs(message.inlineCards, additions),
  };
}

function buildLayoutDraftContent(slideCount: number): string {
  return `内容草稿已就绪（${slideCount} 页待排版），请选择排版方式后继续。`;
}

function finalizeAgentMessage(
  message: ChatMessage,
  presentation: Presentation | undefined,
  fallbackContent: string,
): ChatMessage {
  if (presentation && presentationNeedsLayoutChoice(presentation)) {
    const slideCount = countSlidesNeedingLayout(presentation);
    return attachInlineCards(
      { ...message, content: buildLayoutDraftContent(slideCount) },
      ["layout"],
    );
  }

  return attachInlineCards({ ...message, content: fallbackContent }, ["deck"]);
}

export function App() {
  const initializeProject = useProjectStore((state) => state.initializeProject);
  const hydrateProjectArtifacts = useProjectStore((state) => state.hydrateProjectArtifacts);
  const activeProject = useProjectStore((state) => state.activeProject);

  const [presentation, setPresentation] = useState<Presentation>();
  const [startupError, setStartupError] = useState<string>();
  
  // UI 状态控制
  const [selectedSlideId, setSelectedSlideId] = useState<string>("");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isMirrorOpen, setIsMirrorOpen] = useState(false);
  const [isMirrorExpanded, setIsMirrorExpanded] = useState(false);
  const [isDeckPreviewOpen, setIsDeckPreviewOpen] = useState(false);
  const [isExportingDeck, setIsExportingDeck] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [maxRevision, setMaxRevision] = useState(0);

  // 双模态同构布局模式控制
  const [activeMode, setActiveMode] = useState<"workspace" | "settings">("workspace");
  const [settingsCategory, setSettingsCategory] = useState<"profile" | "models" | "workflow" | "appearance">("profile");

  // 常规设置：常规/工作流与文件系统
  const [autoDownload, setAutoDownload] = useState(true);
  const [autoCloudSync, setAutoCloudSync] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  /** @deprecated 与 workspacePath 同步，供 UnifiedAgentInput 等遗留组件使用 */
  const [localStoragePath, setLocalStoragePath] = useState("");
  const [defaultRatio, setDefaultRatio] = useState<"16:9" | "4:3">("16:9");
  const [executionStrategy, setExecutionStrategy] = useState<"REQUEST_APPROVAL" | "AUTO">("REQUEST_APPROVAL");
  const [agentStepLimits, setAgentStepLimits] = useState<AgentStepLimits>(loadAgentStepLimits);
  const [agentGatewayPreferences, setAgentGatewayPreferences] = useState<AgentGatewayPreferences>(
    loadAgentGatewayPreferences,
  );

  // 外观定制与视效控制阀
  const [themeMode, setThemeMode] = useState<"light" | "dark" | "system">("light");
  const [borderRadiusScale, setBorderRadiusScale] = useState(1.0);
  const [colorContrastOffset, setColorContrastOffset] = useState(0);
  const [computedTheme, setComputedTheme] = useState<"light" | "dark">("light");

  // 编排属性
  const [selectedTheme, setSelectedTheme] = useState<string>("nordic");
  const [selectedPalette, setSelectedPalette] = useState<string>("cyan");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [models, setModels] = useState<ManagedModel[]>(loadManagedModels);
  const [selectedModelId, setSelectedModelId] = useState(
    () => window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY) ?? DEFAULT_MODELS[0].id,
  );
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(models));
    if (!models.some((model) => model.id === selectedModelId) && models[0]) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    saveAgentStepLimits(agentStepLimits);
  }, [agentStepLimits]);

  useEffect(() => {
    saveAgentGatewayPreferences(agentGatewayPreferences);
  }, [agentGatewayPreferences]);

  const handleSaveModel = (model: ManagedModel) => {
    setModels((current) => {
      const exists = current.some((item) => item.id === model.id);
      return exists
        ? current.map((item) => (item.id === model.id ? model : item))
        : [...current, model];
    });
  };

  const handleDeleteModel = (id: string) => {
    setModels((current) => current.filter((model) => model.id !== id));
    if (selectedModelId === id) {
      const fallback = models.find((model) => model.id !== id);
      if (fallback) setSelectedModelId(fallback.id);
    }
  };

  // 系统主题跟随与计算
  useEffect(() => {
    if (themeMode === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        setComputedTheme(mediaQuery.matches ? "dark" : "light");
      };
      setComputedTheme(mediaQuery.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      setComputedTheme(themeMode);
    }
  }, [themeMode]);

  // 实时外观视觉控制阀应用 (圆角与色彩对比度)
  useEffect(() => {
    document.documentElement.style.setProperty("--border-radius-scale", borderRadiusScale.toString());
  }, [borderRadiusScale]);

  useEffect(() => {
    const isDark = computedTheme === "dark";
    if (isDark) {
      const lightness = Math.max(8, 12 - colorContrastOffset);
      document.documentElement.style.setProperty("--bg-app", `hsl(0, 0%, ${lightness}%)`);
      document.documentElement.style.setProperty("--bg-canvas", `hsl(0, 0%, ${lightness}%)`);
      document.documentElement.style.setProperty("--bg-glass", `hsl(0, 0%, ${lightness}%)`);
    } else {
      const lightness = Math.min(100, 100 - colorContrastOffset);
      document.documentElement.style.setProperty("--bg-app", `hsl(0, 0%, ${lightness}%)`);
      document.documentElement.style.setProperty("--bg-canvas", `hsl(0, 0%, ${lightness}%)`);
      document.documentElement.style.setProperty("--bg-glass", `hsl(0, 0%, ${lightness}%)`);
    }
  }, [computedTheme, colorContrastOffset]);

  useEffect(() => {
    if (presentation) {
      if (presentation.theme && presentation.theme !== selectedTheme) {
        setSelectedTheme(presentation.theme);
      }
      if (presentation.palette && presentation.palette !== selectedPalette) {
        setSelectedPalette(presentation.palette);
      }
    }
  }, [presentation]);

  // 对话流与 Agent 编排状态
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activityTrace, setActivityTrace] = useState<AgentActivityItem[]>([]);
  const [thoughtProgress, setThoughtProgress] = useState(0);
  const [agentActivityMode, setAgentActivityMode] = useState<"idle" | "request" | "workflow" | "reasoning">("idle");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [highlightSlideId, setHighlightSlideId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunTraceRef = useRef<AgentActivityItem[]>([]);
  const requestStatusStepIdRef = useRef<string | null>(null);
  const streamMessageIdsRef = useRef(new Map<string, string>());
  const statusTypingTimerRef = useRef<number | null>(null);

  const syncActivityTrace = useCallback((next: AgentActivityItem[]) => {
    activeRunTraceRef.current = next;
    setActivityTrace(next);

    const runId = activeRunIdRef.current;
    if (!runId) return;
    const messageId = streamMessageIdsRef.current.get(runId);
    if (!messageId) return;
    if (next.length === 0) return;

    setChatMessages((prev) => prev.map((message) =>
      message.id === messageId
        ? {
            ...message,
            activityTrace: mergeActivityTraces(message.activityTrace, next),
          }
        : message,
    ));
  }, []);

  useEffect(() => {
    const stopStatusTyping = () => {
      if (statusTypingTimerRef.current !== null) {
        window.clearInterval(statusTypingTimerRef.current);
        statusTypingTimerRef.current = null;
      }
    };
    const unsubscribe = window.desktopApi.onAgentStream((event: AgentStreamEvent) => {
      if (event.runId !== activeRunIdRef.current) return;

      if (event.type === "request-status") {
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
              text: event.message.slice(0, 1),
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
                event.message.slice(0, visibleLength),
              ),
            );
          }
          if (visibleLength >= event.message.length) stopStatusTyping();
        }, 28);
        return;
      }

      if (event.type === "workflow-progress") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        syncActivityTrace(appendStep(activeRunTraceRef.current, event.message, "done"));
        setThoughtProgress(event.progress);
        return;
      }

      if (event.type === "stage-started") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        syncActivityTrace(appendStep(activeRunTraceRef.current, `🚀 启动阶段: ${event.message}`, "done"));
        return;
      }

      if (event.type === "tool-started") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        setActiveToolName(event.toolName);
        if (event.toolName !== "Task") {
          syncActivityTrace(
            appendToolStart(
              activeRunTraceRef.current,
              event.toolName,
              `🛠️ 运行工具: ${event.toolName}`,
            ),
          );
        }
        return;
      }

      if (event.type === "tool-finished") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        setActiveToolName(null);
        if (event.toolName === "Task") {
          let trace = activeRunTraceRef.current;
          for (const item of trace) {
            if (item.kind === "task" && item.status === "running") {
              trace = finishTask(trace, item.taskId);
            }
          }
          syncActivityTrace(trace);
        } else {
          syncActivityTrace(
            finishTool(
              activeRunTraceRef.current,
              event.toolName,
              `✅ 工具 ${event.toolName} 运行完毕`,
            ),
          );
        }
        return;
      }

      if (event.type === "tool-validation-failed") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        setActiveToolName(null);
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
        syncActivityTrace(appendStep(activeRunTraceRef.current, "⏳ 等待用户审批", "done"));
        return;
      }

      if (event.type === "tool-approval-waiting") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        setActiveToolName(event.toolName);
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

      if (event.type === "todo-updated") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        syncActivityTrace(upsertTodoTrace(activeRunTraceRef.current, event.todos));
        return;
      }

      if (event.type === "subagent-started") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        setActiveToolName("Task");
        syncActivityTrace(
          upsertTaskStarted(activeRunTraceRef.current, {
            taskId: event.taskId,
            description: event.description,
          }),
        );
        return;
      }

      if (event.type === "subagent-thinking-chunk") {
        setAgentActivityMode("reasoning");
        syncActivityTrace(
          appendTaskReasoningChunk(activeRunTraceRef.current, event.taskId, event.chunk),
        );
        return;
      }

      if (event.type === "subagent-tool-started") {
        setAgentActivityMode("workflow");
        setActiveToolName(event.toolName);
        syncActivityTrace(
          appendTaskToolStart(
            activeRunTraceRef.current,
            event.taskId,
            event.toolName,
            event.message,
          ),
        );
        return;
      }

      if (event.type === "subagent-tool-finished") {
        setActiveToolName(null);
        syncActivityTrace(
          finishTaskTool(
            activeRunTraceRef.current,
            event.taskId,
            event.toolName,
            event.message,
          ),
        );
        return;
      }

      if (event.type === "subagent-finished") {
        syncActivityTrace(finishTask(activeRunTraceRef.current, event.taskId));
        return;
      }

      if (event.type === "thinking-chunk") {
        stopStatusTyping();
        setAgentActivityMode("reasoning");
        syncActivityTrace(
          appendReasoningChunk(
            activeRunTraceRef.current,
            event.chunk,
            event.modelStep ?? 0,
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
            setChatMessages((prev) => [
              ...prev,
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
        if (!messageId) {
          messageId = crypto.randomUUID();
          streamMessageIdsRef.current.set(event.runId, messageId);
          setChatMessages((prev) => [
            ...prev,
            {
              id: messageId!,
              role: "assistant",
              content: event.chunk,
              activityTrace: sealedTrace.length > 0 ? sealedTrace : undefined,
            },
          ]);
        } else {
          setChatMessages((prev) => prev.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  content: message.content + event.chunk,
                  activityTrace: mergeActivityTraces(message.activityTrace, sealedTrace),
                }
              : message,
          ));
        }
        return;
      }
    });
    return () => {
      stopStatusTyping();
      unsubscribe();
    };
  }, [syncActivityTrace]);

  // 会话状态由 Electron 主进程持久化，渲染进程只保留当前快照
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  /** 居中放大初始化页（发送首条消息前） */
  const [isDraftChat, setIsDraftChat] = useState(true);

  // 实时预览面板快捷键监听 (Cmd+Option+P 或 Ctrl+Alt+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const pressedP = e.key.toLowerCase() === "p";
      const matches = isMac
        ? e.metaKey && e.altKey && pressedP
        : e.ctrlKey && e.altKey && pressedP;

      if (matches) {
        e.preventDefault();
        setIsMirrorOpen((prev) => {
          const next = !prev;
          triggerToast(next ? "已打开右侧预览" : "已关闭右侧预览");
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  type PresentationSyncOptions = {
    preferredSlideId?: string;
    selectLastSlide?: boolean;
    openMirror?: boolean;
    highlightSlide?: boolean;
  };

  /** 从 Main CommandBus 拉取演示稿快照，作为 renderer 侧唯一同步入口 */
  async function syncPresentation(options: PresentationSyncOptions = {}) {
    try {
      const snapshot = await window.desktopApi.getPresentation();
      setPresentation(snapshot);
      setMaxRevision(snapshot.revision);

      let nextSlideId = options.preferredSlideId;
      if (options.selectLastSlide && snapshot.slides.length > 0) {
        nextSlideId = snapshot.slides[snapshot.slides.length - 1].id;
      }
      if (nextSlideId && snapshot.slides.some((slide) => slide.id === nextSlideId)) {
        setSelectedSlideId(nextSlideId);
      } else if (snapshot.slides.length > 0) {
        setSelectedSlideId(snapshot.slides[0].id);
      } else {
        setSelectedSlideId("");
      }

      if (options.highlightSlide && nextSlideId) {
        setHighlightSlideId(nextSlideId);
        setTimeout(() => setHighlightSlideId(null), 2500);
      }

      if (options.openMirror) {
        setIsMirrorOpen(true);
      }

      return snapshot;
    } catch (error) {
      console.error("同步演示文稿失败:", error);
      return undefined;
    }
  }

  const enterDraftChat = (workspaceDir?: string) => {
    setIsDraftChat(true);
    setActiveSessionId("");
    setChatMessages([]);
    setPresentation(undefined);
    setRequest("");
    setSelectedSlideId("");
    setSelectedElementId(null);
    setMaxRevision(0);
    setIsMirrorOpen(false);
    setWorkspacePath("");
    setLocalStoragePath(workspaceDir ? normalizeWorkspacePath(workspaceDir) : "");
    useProjectStore.getState().resetProject();
  };

  const applySessionState = (state: SessionBootstrap) => {
    setSessions(state.sessions);
    if (!state.activeSession) {
      enterDraftChat();
      setSessionLoaded(true);
      return;
    }

    const snapshot = state.activeSession;
    setIsDraftChat(snapshot.messages.length === 0);
    setActiveSessionId(snapshot.session.id);
    setPresentation(snapshot.presentation);
    setChatMessages(snapshot.messages);
    setRequest("");
    setSelectedSlideId(snapshot.presentation.slides[0]?.id ?? "");
    setSelectedElementId(null);
    setMaxRevision(snapshot.presentation.revision);
    setSessionLoaded(true);
    setIsMirrorOpen(snapshot.presentation.revision > 0);
    if (snapshot.project?.rootPath) {
      const resolved = resolveWorkspacePath({
        workspacePath: snapshot.session.workspacePath,
        projectRootPath: snapshot.project.rootPath,
      });
      if (resolved) {
        setWorkspacePath(resolved);
        setLocalStoragePath(resolved);
      } else {
        setWorkspacePath("");
        setLocalStoragePath("");
      }
    } else {
      setWorkspacePath("");
      setLocalStoragePath("");
    }

    initializeProject(snapshot.session.id, snapshot.session.title, snapshot.project?.artifacts);
    void hydrateProjectArtifacts(snapshot.session.id).catch((error) => {
      console.error("加载项目产物失败:", error);
      triggerToast(error instanceof Error ? error.message : "加载项目产物失败");
    });
    void syncPresentation({
      preferredSlideId: snapshot.presentation.slides[0]?.id,
      openMirror: snapshot.presentation.revision > 0,
    });
  };

  // 从主进程恢复最近一次激活的会话
  useEffect(() => {
    if (!window.desktopApi) {
      setStartupError("桌面通信桥接加载失败，请重启应用程序。");
      return;
    }
    void window.desktopApi
      .getSessionState()
      .then(applySessionState)
      .catch((error: unknown) => {
        setStartupError(error instanceof Error ? error.message : "无法打开本地工作区。");
      });
  }, []);

  // 即时刷新会话列表元信息；主进程会在文稿变更时同步落盘
  useEffect(() => {
    if (presentation && activeSessionId) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                title: presentation.title || s.title,
                slideCount: presentation.slides.length,
                revision: presentation.revision,
              }
            : s
        )
      );
    }
  }, [presentation, activeSessionId]);

  // 对话内容采用短防抖保存，避免流式 UI 更新造成频繁磁盘写入
  useEffect(() => {
    if (!sessionLoaded || !activeSessionId) return;
    const messages = toSessionChatMessages(chatMessages);
    const timer = setTimeout(() => {
      void window.desktopApi.saveSessionMessages(activeSessionId, messages).catch((error) => {
        console.error("保存会话消息失败:", error);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [activeSessionId, chatMessages, sessionLoaded]);

  // 追踪最大版本号以推导 canRedo
  useEffect(() => {
    if (presentation && presentation.revision > maxRevision) {
      setMaxRevision(presentation.revision);
    }
  }, [presentation]);

  // 提示信息气泡
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSelectWorkspaceFolder = async () => {
    if (busy) {
      triggerToast("当前任务执行中，请稍后再选择目录");
      return;
    }
    try {
      const selectedPath = await window.desktopApi.selectDirectory(
        localStoragePath || workspacePath || undefined,
      );
      if (!selectedPath) return;
      const normalized = normalizeWorkspacePath(selectedPath);
      setLocalStoragePath(normalized);
      triggerToast(`已选择目录：${getWorkspaceLabel(normalized)}`);
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : "选择目录失败");
    }
  };

  const handleOpenWorkspace = async () => {
    if (busy) {
      triggerToast("当前任务执行中，请稍后再打开目录");
      return;
    }
    try {
      const selectedPath = await window.desktopApi.selectDirectory(
        workspacePath || localStoragePath || undefined,
      );
      if (!selectedPath) return;

      setSessionLoaded(false);
      const state = await window.desktopApi.openWorkspace(selectedPath);
      applySessionState(state);
      triggerToast(`已打开项目目录：${getWorkspaceLabel(selectedPath)}`);
    } catch (error) {
      setSessionLoaded(true);
      triggerToast(error instanceof Error ? error.message : "打开项目目录失败");
    }
  };

  // 新建会话：仅进入居中放大初始化页，发送首条消息后再创建会话
  const handleNewSession = () => {
    if (busy) {
      triggerToast("当前任务执行中，请稍后再新建会话");
      return;
    }
    enterDraftChat();
  };

  // 在指定目录下新建：预填目录，仍停留在初始化页
  const handleNewSessionInWorkspace = (targetWorkspacePath: string) => {
    if (busy) {
      triggerToast("当前任务执行中，请稍后再新建会话");
      return;
    }
    enterDraftChat(targetWorkspacePath);
  };

  // 切换会话并从主进程载入完整持久化快照
  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    if (busy) {
      triggerToast("当前任务执行中，请稍后再切换会话");
      return;
    }
    setSessionLoaded(false);
    try {
      applySessionState(await window.desktopApi.selectSession(sessionId));
      triggerToast("已恢复会话内容");
    } catch (error) {
      setSessionLoaded(true);
      triggerToast(error instanceof Error ? error.message : "切换会话失败");
    }
  };

  // 删除会话
  const handleDeleteSession = async (sessionId: string) => {
    if (busy) {
      triggerToast("当前任务执行中，请稍后再删除会话");
      return;
    }
    try {
      const state = await window.desktopApi.deleteSession(sessionId);
      const isDeleted = !state.sessions.some((s) => s.id === sessionId);
      applySessionState(state);
      if (isDeleted) {
        triggerToast("会话已删除");
      }
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : "删除会话失败");
    }
  };

  async function applyAgentResult(result: AgentRunResult, trace: AgentActivityItem[], runId?: string) {
    const messageId = runId ? streamMessageIdsRef.current.get(runId) : undefined;
    const finalizeTrace = (existing?: AgentActivityItem[]) => markTraceComplete(
      mergeActivityTraces(existing, trace, activeRunTraceRef.current) ?? [],
    );
    const resolvedTrace = (existing?: AgentActivityItem[]) => {
      const merged = finalizeTrace(existing);
      return merged.length > 0 ? merged : undefined;
    };

    if (result.status === "chat") {
      if (messageId) {
        setChatMessages((prev) => prev.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: result.message,
                activityTrace: resolvedTrace(message.activityTrace),
                threadId: result.threadId,
              }
            : message,
        ));
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: result.message,
            activityTrace: resolvedTrace(),
            threadId: result.threadId,
          },
        ]);
      }
      return;
    }

    if (result.status === "approval-required") {
      if (messageId) {
        setChatMessages((prev) => prev.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: "已提出排版更新方案，请在下方审核后应用。",
                activityTrace: resolvedTrace(message.activityTrace),
                approval: result.approval,
              }
            : message
        ));
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "已提出排版更新方案，请在下方审核后应用。",
            activityTrace: resolvedTrace(),
            approval: result.approval,
          },
        ]);
      }
      triggerToast("AI 已提出排版变更方案，请进行审核");
      return;
    }

    if (result.status === "completed" || result.status === "rejected") {
      await syncPresentation({
        selectLastSlide: result.status === "completed",
        openMirror: result.status === "completed",
        highlightSlide: result.status === "completed",
      });
      if (result.status === "completed") {
        await hydrateProjectArtifacts(activeSessionId || undefined);
      }
    }

    const finalContent = result.status === "rejected"
      ? "已放弃排版变更提案。"
      : "已根据确认的大纲生成并应用演示文稿。";
    const applyCompletion = (message: ChatMessage): ChatMessage => {
      if (result.status !== "completed") {
        return { ...message, content: finalContent };
      }
      return finalizeAgentMessage(message, result.presentation, finalContent);
    };

    if (messageId) {
      setChatMessages((prev) => prev.map((message) =>
        message.id === messageId ? applyCompletion(message) : message
      ));
    } else {
      setChatMessages((prev) => [
        ...prev,
        applyCompletion({
          id: crypto.randomUUID(),
          role: "assistant",
          content: finalContent,
        }),
      ]);
    }
    triggerToast(
      result.status === "rejected"
        ? "变更已取消"
        : result.presentation && presentationNeedsLayoutChoice(result.presentation)
          ? "内容草稿已就绪，请选择排版方式"
          : "演示文稿已成功更新",
    );
  }

  // 提交需求或继续当前大纲对话
  async function startAgent(customRequest?: string, isEditOfMsgId?: string) {
    const activeRequest = customRequest || request;
    if (!activeRequest.trim() || busy) return;

    if (presentation && isExportPrompt(activeRequest)) {
      const userMsgId = crypto.randomUUID();
      setChatMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: activeRequest },
      ]);
      if (!customRequest) setRequest("");
      await handleExportDeck(activeRequest);
      return;
    }

    if (presentation && isPreviewPrompt(activeRequest)) {
      const userMsgId = crypto.randomUUID();
      setChatMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: activeRequest },
      ]);
      if (!customRequest) setRequest("");
      setIsDeckPreviewOpen(true);
      setIsMirrorOpen(true);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "已打开演示文稿预览，你可以在右侧或弹窗中查看全部页面。",
          inlineCards: [{ type: "deck" }],
        },
      ]);
      triggerToast("已打开演示文稿预览");
      return;
    }

    setBusy(true);
    setIsDraftChat(false);
    let agentSessionId = activeSessionId;
    let sessionCreatedWithWorkspace = false;

    if (!localStoragePath) {
      setBusy(false);
      setIsDraftChat(true);
      triggerToast("请先选择项目目录");
      return;
    }

    if (!agentSessionId) {
      try {
        const state = await window.desktopApi.createSession(
          localStoragePath ? { rootPath: localStoragePath } : undefined,
        );
        sessionCreatedWithWorkspace = Boolean(localStoragePath);
        applySessionState(state);
        setIsDraftChat(false);
        agentSessionId = state.activeSession!.session.id;
      } catch (error) {
        setBusy(false);
        setIsDraftChat(true);
        triggerToast(error instanceof Error ? error.message : "创建会话失败");
        return;
      }
    }

    if (!sessionCreatedWithWorkspace && !workspacePath && localStoragePath) {
      try {
        const state = await window.desktopApi.migrateLegacySessionToWorkspace(
          agentSessionId,
          localStoragePath,
        );
        applySessionState(state);
        setIsDraftChat(false);
        agentSessionId = state.activeSession!.session.id;
      } catch (error) {
        setBusy(false);
        setIsDraftChat(chatMessages.length === 0);
        triggerToast(error instanceof Error ? error.message : "绑定项目目录失败");
        return;
      }
    }

    const activeProjectObj = useProjectStore.getState().activeProject;
    if (!agentSessionId || !activeProjectObj) {
      setBusy(false);
      triggerToast("项目会话尚未准备好，请稍后再试");
      return;
    }

    const editorContext = {
      currentSlideId: selectedSlideId || undefined,
      selectedElementIds: selectedElementId ? [selectedElementId] : [],
    };
    const agentRequest: AgentRunRequest = {
      prompt: activeRequest,
      sessionId: agentSessionId,
      editorContext,
    };

    console.info("Starting unified Agent run", {
      sessionId: agentRequest.sessionId,
      editorContext,
    });

    setThoughtProgress(0);
    syncActivityTrace([]);
    setActiveToolName(null);
    setAgentActivityMode("request");
    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
    activeRunTraceRef.current = [];
    requestStatusStepIdRef.current = null;
    let forkedMessages: ChatMessage[] | undefined;

    if (isEditOfMsgId) {
      const idx = chatMessages.findIndex((m) => m.id === isEditOfMsgId);
      if (idx !== -1) {
        forkedMessages = chatMessages.slice(0, idx + 1);
        forkedMessages[idx] = {
          ...forkedMessages[idx],
          id: crypto.randomUUID(),
          content: activeRequest,
        };
        setChatMessages(forkedMessages);
      }
    } else {
      const userMsgId = crypto.randomUUID();
      setChatMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: activeRequest },
      ]);
    }
    
    if (!customRequest) {
      setRequest("");
    }

    try {
      if (forkedMessages && agentSessionId) {
        await window.desktopApi.saveSessionMessages(
          agentSessionId,
          toSessionChatMessages(forkedMessages),
        );
      }
      const gatewayConfig = buildAgentGatewayConfig(agentGatewayPreferences, models);
      const activeThreadId = findActiveThreadId(forkedMessages ?? chatMessages);
      const result = activeThreadId
        ? await window.desktopApi.continueAgentRun(
            activeThreadId,
            agentRequest,
            agentStepLimits,
            gatewayConfig,
            runId,
          )
        : await window.desktopApi.startAgentRun(
            agentRequest,
            selectedModel ? toAgentModelSettings(selectedModel) : undefined,
            executionStrategy,
            agentStepLimits,
            gatewayConfig,
            runId,
          );
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      await applyAgentResult(result, activeRunTraceRef.current, runId);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `执行指令时发生错误：${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      activeRunIdRef.current = null;
      setActiveRunId(null);
      streamMessageIdsRef.current.delete(runId);
      if (statusTypingTimerRef.current !== null) {
        window.clearInterval(statusTypingTimerRef.current);
        statusTypingTimerRef.current = null;
      }
      setBusy(false);
      setAgentActivityMode("idle");
      setActiveToolName(null);
      syncActivityTrace([]);
      setThoughtProgress(0);
      requestStatusStepIdRef.current = null;
      activeRunTraceRef.current = [];
    }
  }

  const handleCancelRun = async () => {
    if (activeRunIdRef.current) {
      const cancelled = await window.desktopApi.cancelAgentRun(activeRunIdRef.current);
      if (cancelled) {
        triggerToast("🚫 任务已取消");
      }
    }
  };

  const handleRetryMessage = (msgId: string) => {
    const idx = chatMessages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    const priorUserMsg = chatMessages
      .slice(0, idx)
      .reverse()
      .find((m) => m.role === "user");
    if (priorUserMsg) {
      void startAgent(priorUserMsg.content);
    }
  };



  // 推荐指令点击快捷处理
  const handleSuggestPrompt = (prompt: string) => {
    setRequest(prompt);
    void startAgent(prompt);
  };

  // 确认或拒绝运行中的工具操作（权限闸门 3）
  async function resolveToolApproval(approvalId: string, approved: boolean) {
    const runId = activeRunIdRef.current;
    if (!runId || !busy) return;
    syncActivityTrace(
      resolveToolApprovalItem(activeRunTraceRef.current, approvalId, approved ? "approved" : "denied"),
    );
    await window.desktopApi.resolveToolApproval(runId, approvalId, approved);
  }

  // 确认或拒绝 Deck 排版变更方案
  async function resolveApproval(
    approved: boolean,
    approvalRequest: AgentApprovalRequest,
    messageId: string,
  ) {
    if (!approvalRequest || busy || !activeSessionId) return;
    setBusy(true);
    setThoughtProgress(20);
    syncActivityTrace([
      {
        id: crypto.randomUUID(),
        kind: "step",
        text: approved ? "正在应用排版变更方案到工作台..." : "正在撤销已草拟的排版方案...",
        status: "running",
      },
      {
        id: crypto.randomUUID(),
        kind: "step",
        text: "同步客户端最新数据状态...",
        status: "typing",
      },
    ]);

    const progressInterval = setInterval(() => {
      setThoughtProgress((p) => (p >= 95 ? 95 : p + 25));
    }, 200);

    try {
      const result = await window.desktopApi.resumeAgentRun(
        activeSessionId,
        approvalRequest.threadId,
        approved,
      );
      clearInterval(progressInterval);
      setThoughtProgress(100);

      const resolvedContent = approved ? "已成功应用变更方案。" : "已放弃排版变更提案。";

      if (result.status === "completed" || result.status === "rejected") {
        await syncPresentation({
          selectLastSlide: approved,
          openMirror: approved,
          highlightSlide: approved,
        });
        await hydrateProjectArtifacts(activeSessionId);
        const syncedPresentation = await window.desktopApi.getPresentation();
        setChatMessages((prev) => prev.map((message) => {
          if (message.id !== messageId) return message;
          if (!approved) {
            return { ...message, approval: undefined, content: resolvedContent };
          }
          return {
            ...finalizeAgentMessage(
              { ...message, approval: undefined },
              syncedPresentation,
              resolvedContent,
            ),
          };
        }));
        triggerToast(approved ? "✅ 变更已应用" : "❌ 变更已取消");
      }
    } catch (err) {
      clearInterval(progressInterval);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `确认变更时发生异常：${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setBusy(false);
      syncActivityTrace([]);
      setThoughtProgress(0);
    }
  }

  // 历史撤销重做操作
  async function handleHistory(action: "undo" | "redo") {
    setBusy(true);
    try {
      await window.desktopApi[action]();
      await syncPresentation({ selectLastSlide: true });
      setSelectedElementId(null);
      triggerToast(`${action === "undo" ? "⏪ 已撤销" : "⏩ 已重做"} 上一步修改`);
    } finally {
      setBusy(false);
    }
  }

  // 更新元素细节 (拖拽/文本修改/参数修改等双向映射)
  const handleUpdateElement = async (slideId: string, elementId: string, updatedElement: SlideElement) => {
    if (!presentation) return;

    // 乐观更新 UI
    const updatedSlides = presentation.slides.map((slide) => {
      if (slide.id !== slideId) return slide;
      const updatedElements = slide.elements.map((el) => (el.id === elementId ? updatedElement : el));
      return { ...slide, elements: updatedElements };
    });
    setPresentation({ ...presentation, slides: updatedSlides });

    try {
      await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "update-element",
        slideId,
        elementId,
        element: updatedElement,
      });
      await syncPresentation({ preferredSlideId: slideId, highlightSlide: true });
    } catch (err) {
      console.error("更新页面元素失败:", err);
      void syncPresentation({ preferredSlideId: slideId });
    }
  };

  const handleUpdateElementPosition = async (
    slideId: string,
    elementId: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    if (!presentation) return;
    const activeSlide = presentation.slides.find((s) => s.id === slideId);
    if (!activeSlide) return;
    const element = activeSlide.elements.find((el) => el.id === elementId);
    if (!element) return;

    const updatedElement = { ...element, x, y, width, height };

    // 乐观更新 UI
    const updatedSlides = presentation.slides.map((slide) => {
      if (slide.id !== slideId) return slide;
      const updatedElements = slide.elements.map((el) => (el.id === elementId ? updatedElement : el));
      return { ...slide, elements: updatedElements };
    });
    setPresentation({ ...presentation, slides: updatedSlides });

    try {
      await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "update-element",
        slideId,
        elementId,
        element: updatedElement,
      });
      await syncPresentation({ preferredSlideId: slideId });
    } catch (err) {
      console.error("更新元素坐标失败:", err);
      void syncPresentation({ preferredSlideId: slideId });
    }
  };

  const handleAddSlideLocally = async () => {
    if (!presentation) return;
    const newSlideId = crypto.randomUUID();
    const newSlide = {
      id: newSlideId,
      title: "新空白幻灯片",
      elements: [
        {
          id: crypto.randomUUID(),
          type: "text" as const,
          x: 120,
          y: 220,
          width: 1040,
          height: 180,
          text: "双击此处编辑文本内容，或随意拖拽调整位置。",
          fontSize: 32,
        },
      ],
    };

    try {
      await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "add-slide",
        slide: newSlide,
        index: presentation.slides.length,
      });
      await syncPresentation({ preferredSlideId: newSlideId, highlightSlide: true });
      setSelectedElementId(null);
      triggerToast("➕ 已新建空白幻灯片");
    } catch (err) {
      console.error("新增幻灯片失败:", err);
      void syncPresentation();
    }
  };

  const handleDuplicateSlideLocally = async (slideId: string) => {
    if (!presentation) return;
    const idx = presentation.slides.findIndex((s) => s.id === slideId);
    if (idx < 0) return;
    const originalSlide = presentation.slides[idx];
    const newSlideId = crypto.randomUUID();
    const duplicatedSlide = {
      ...structuredClone(originalSlide),
      id: newSlideId,
    };

    try {
      await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "add-slide",
        slide: duplicatedSlide,
        index: idx + 1,
      });
      await syncPresentation({ preferredSlideId: newSlideId, highlightSlide: true });
      setSelectedElementId(null);
      triggerToast("📂 已复制当前幻灯片");
    } catch (err) {
      console.error("复制幻灯片失败:", err);
      void syncPresentation();
    }
  };

  const handleDeleteSlideLocally = async (slideId: string) => {
    if (!presentation) return;
    if (presentation.slides.length <= 1) return;
    const idx = presentation.slides.findIndex((s) => s.id === slideId);

    try {
      await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "remove-slide",
        slideId,
      });
      const nextIdx = Math.max(0, idx - 1);
      const preferredSlideId = presentation.slides[nextIdx]?.id;
      await syncPresentation({ preferredSlideId });
      setSelectedElementId(null);
      triggerToast("🗑️ 已删除当前幻灯片");
    } catch (err) {
      console.error("删除幻灯片失败:", err);
      void syncPresentation();
    }
  };

  const handleAddElementLocally = async (type: "text" | "image" | "shape") => {
    if (!presentation || !selectedSlideId) return;
    
    let newElement: SlideElement;
    const id = crypto.randomUUID();

    if (type === "text") {
      newElement = {
        id,
        type: "text",
        x: 200,
        y: 200,
        width: 600,
        height: 120,
        text: "双击输入新文本内容",
        fontSize: 28,
      };
    } else if (type === "image") {
      newElement = {
        id,
        type: "image",
        x: 300,
        y: 200,
        width: 400,
        height: 250,
        url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop&q=60",
        borderRadius: 8,
      };
    } else {
      newElement = {
        id,
        type: "shape",
        x: 400,
        y: 250,
        width: 150,
        height: 150,
        shapeType: "rectangle",
        fillColor: "#0ea5e9",
        strokeColor: "#0284c7",
      };
    }

    try {
      await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "add-element",
        slideId: selectedSlideId,
        element: newElement,
      });
      await syncPresentation({ preferredSlideId: selectedSlideId });
      setSelectedElementId(id);
      triggerToast("➕ 已新增画布元素");
    } catch (err) {
      console.error("添加元素失败:", err);
      void syncPresentation({ preferredSlideId: selectedSlideId });
    }
  };

  // 全体一键 AI 美化
  const handleOptimizePresentationLocally = () => {
    if (presentation && presentationNeedsLayoutChoice(presentation)) {
      const slideCount = countSlidesNeedingLayout(presentation);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildLayoutDraftContent(slideCount),
          inlineCards: [{ type: "layout" }],
        },
      ]);
      triggerToast("请选择排版方式");
      return;
    }
    void startAgent("一键美化全局演示文稿，微调排版比例与风格一致性");
  };

  // 修改会话消息文本内容
  const handleUpdateMessageContent = (msgId: string, newContent: string) => {
    const targetMsg = chatMessages.find((msg) => msg.id === msgId);
    if (!targetMsg) return;

    if (targetMsg.role === "user") {
      void startAgent(newContent, msgId);
      triggerToast("✏️ 已更新指令并重新生成");
    } else {
      setChatMessages((prev) =>
        prev.map((msg) => (msg.id === msgId ? { ...msg, content: newContent } : msg))
      );
      triggerToast("✏️ 消息内容已更新");
    }
  };

  const handleLogoUpload = (url: string) => {
    setLogoUrl(url);
    triggerToast("🖼️ 品牌 Logo 已应用至演示文稿模板");
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
    triggerToast("🗑️ 品牌 Logo 已移除");
  };

  const resolveInlineCardContext = () => {
    const project = useProjectStore.getState().activeProject;
    return {
      briefContent: project?.artifacts.brief?.content,
      outlineContent: project?.artifacts.outline?.content,
      presentation,
      projectTitle: project?.name,
    };
  };

  const getInlineCardData = (message: ChatMessage) => {
    const context = resolveInlineCardContext();
    const refs = resolveMessageInlineCards(message.content, message.inlineCards, context);
    return {
      refs,
      briefFields: refs.some((card) => card.type === "brief")
        ? parseBriefForCard(context.briefContent ?? "", context.projectTitle)
        : undefined,
      outlineItems: refs.some((card) => card.type === "outline")
        ? parseOutlineForCard(context.outlineContent ?? "")
        : undefined,
      presentation: refs.some((card) => card.type === "deck") ? presentation : undefined,
      layoutSlideCount: refs.some((card) => card.type === "layout")
        ? countSlidesNeedingLayout(presentation)
        : undefined,
      layoutMode: refs.find((card) => card.type === "layout")?.layoutMode,
    };
  };

  const markInlineCardResolved = (
    messageId: string,
    type: InlineCardRef["type"],
    resolved: InlineCardRef["resolved"],
    layoutMode?: LayoutVisualMode,
  ) => {
    setChatMessages((prev) => prev.map((message) => {
      if (message.id !== messageId) return message;
      const inlineCards = (message.inlineCards ?? [{ type }]).map((card) =>
        card.type === type
          ? { ...card, resolved, ...(layoutMode ? { layoutMode } : {}) }
          : card,
      );
      return { ...message, inlineCards };
    }));
  };

  const handleConfirmBrief = (messageId: string) => {
    void useProjectStore.getState().markStageReady("brief");
    markInlineCardResolved(messageId, "brief", "confirmed");
    triggerToast("✅ Brief 已确认");
  };

  const handleConfirmOutline = (messageId: string) => {
    void useProjectStore.getState().markStageReady("outline");
    markInlineCardResolved(messageId, "outline", "confirmed");
    triggerToast("✅ 大纲已确认");
  };

  const handleReviseOutline = (messageId: string) => {
    markInlineCardResolved(messageId, "outline", "dismissed");
    void startAgent("请根据当前反馈继续修改大纲结构");
  };

  const handleConfirmLayout = (
    messageId: string,
    mode: LayoutVisualMode,
    theme: string,
    palette: string,
  ) => {
    saveLayoutVisualMode(mode);
    setSelectedTheme(theme);
    setSelectedPalette(palette);
    markInlineCardResolved(messageId, "layout", "confirmed", mode);
    triggerToast(mode === "creative" ? "🎨 开始创意装饰排版" : "📐 开始标准排版");
    void startAgent(buildLayoutPhasePrompt(mode, theme, palette));
  };

  const handleOpenDeckPreview = () => {
    setIsDeckPreviewOpen(true);
    setIsMirrorOpen(true);
  };

  const handleExportDeck = async (sourcePrompt?: string) => {
    if (!presentation || isExportingDeck) return;
    setIsExportingDeck(true);
    try {
      const savedPath = await window.desktopApi.exportPresentation(presentation, {
        theme: selectedTheme,
        palette: selectedPalette,
        logoUrl,
      });
      const exportMessage = savedPath
        ? `演示文稿已导出至：${savedPath}`
        : "已取消导出。";
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: sourcePrompt ? exportMessage : exportMessage,
          inlineCards: savedPath ? [{ type: "deck" as const, resolved: "confirmed" as const }] : undefined,
        },
      ]);
      if (savedPath) {
        triggerToast(`🎉 成功导出至: ${savedPath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `导出失败：${message}`,
        },
      ]);
      triggerToast(`❌ 导出失败: ${message}`);
    } finally {
      setIsExportingDeck(false);
    }
  };

  if (startupError) return <main className="loading error">{startupError}</main>;
  if (!sessionLoaded) return <main className="loading">正在打开本地演示文稿工作区...</main>;

  const selectedSlideIndex = presentation?.slides.findIndex((s) => s.id === selectedSlideId) ?? -1;
  const activeSlideIndexValue = selectedSlideIndex >= 0 ? selectedSlideIndex : null;
  const streamingMessageId =
    busy && activeRunId
      ? streamMessageIdsRef.current.get(activeRunId) ?? null
      : null;

  return (
    <main className={`app-shell ${computedTheme === "dark" ? "dark-theme" : ""}`}>
      {/* 浮动提示通知 */}
      {toastMessage && <div className="floating-toast-alert">{toastMessage}</div>}

      {/* 三栏/双模态同构容器 */}
      <div className={`workspace-container mode-${activeMode}`}>
        {activeMode === "workspace" ? (
          <>
            {/* 左栏：工作台导航 */}
            <LeftPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={() => void handleNewSession()}
              onNewSessionInWorkspace={(path) => void handleNewSessionInWorkspace(path)}
              onToggleSettings={() => {
                setActiveMode("settings");
                setSettingsCategory("profile");
              }}
              onDeleteSession={handleDeleteSession}
            />

            <div className="rounded-canvas" style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
              <div
                className={[
                  "workspace-canvas-content",
                  isDraftChat ? "new-session-layout" : "",
                  isMirrorOpen && presentation ? "ppt-mirror-open" : "ppt-mirror-closed workspace-canvas-content-chat-only",
                  isMirrorExpanded ? "mirror-expanded" : "",
                ].filter(Boolean).join(" ")}
                style={{ display: isMirrorOpen ? undefined : "flex", flex: 1, width: "100%", height: "100%", overflow: "hidden" }}
              >
                <ChatWorkspace
                  isNewChat={isDraftChat}
                  chatMessages={chatMessages}
                  activityTrace={activityTrace}
                  thoughtProgress={thoughtProgress}
                  agentActivityMode={agentActivityMode}
                  activeToolName={activeToolName}
                  streamingMessageId={streamingMessageId}
                  request={request}
                  onChangeRequest={setRequest}
                  onSubmitRequest={() => void startAgent()}
                  busy={busy}
                  onResolveApproval={resolveApproval}
                  onResolveToolApproval={(approvalId, approved) => {
                    void resolveToolApproval(approvalId, approved);
                  }}
                  getInlineCardData={getInlineCardData}
                  onConfirmBrief={handleConfirmBrief}
                  onConfirmOutline={handleConfirmOutline}
                  onConfirmLayout={handleConfirmLayout}
                  onReviseOutline={handleReviseOutline}
                  onOpenDeckPreview={handleOpenDeckPreview}
                  onExportDeck={() => void handleExportDeck()}
                  isExportingDeck={isExportingDeck}
                  selectedTheme={selectedTheme}
                  selectedPalette={selectedPalette}
                  activeRunId={activeRunId}
                  onCancelRun={handleCancelRun}
                  onRetry={handleRetryMessage}
                  themeMode={computedTheme}
                  onToggleThemeMode={() => setThemeMode(computedTheme === "light" ? "dark" : "light")}
                  isMirrorOpen={isMirrorOpen}
                  onToggleMirror={() => setIsMirrorOpen(!isMirrorOpen)}
                  onUndo={() => void handleHistory("undo")}
                  onRedo={() => void handleHistory("redo")}
                  canUndo={presentation ? presentation.revision > 0 : false}
                  canRedo={presentation ? presentation.revision < maxRevision : false}
                  selectedSlideIndex={activeSlideIndexValue}
                  onClearContextTag={() => setSelectedSlideId("")}
                  onUpdateMessageContent={handleUpdateMessageContent}
                  onProposePrompt={handleSuggestPrompt}
                  models={models}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                  executionStrategy={executionStrategy}
                  setExecutionStrategy={setExecutionStrategy}
                  localStoragePath={localStoragePath}
                  onSelectWorkspace={() => void handleSelectWorkspaceFolder()}
                  triggerToast={triggerToast}
                />

                {isMirrorOpen && presentation ? (
                  <PPTMirror
                    presentation={presentation}
                    selectedSlideId={selectedSlideId}
                    onSelectSlide={setSelectedSlideId}
                    selectedTheme={selectedTheme}
                    selectedPalette={selectedPalette}
                    logoUrl={logoUrl}
                    onOptimizePresentation={handleOptimizePresentationLocally}
                    highlightSlideId={highlightSlideId}
                    isExpanded={isMirrorExpanded}
                    onToggleExpand={() => setIsMirrorExpanded((value) => !value)}
                    triggerToast={triggerToast}
                  />
                ) : null}
              </div>

              <DeckPreviewModal
                open={isDeckPreviewOpen && Boolean(presentation)}
                presentation={presentation ?? { id: "", title: "", revision: 0, slides: [] }}
                selectedSlideId={selectedSlideId}
                selectedTheme={selectedTheme}
                selectedPalette={selectedPalette}
                logoUrl={logoUrl}
                onSelectSlide={setSelectedSlideId}
                onClose={() => setIsDeckPreviewOpen(false)}
              />
            </div>
          </>
        ) : (
          <>
            {/* 左栏：系统设置分类导航 */}
            <SettingsSidebar
              activeCategory={settingsCategory}
              onSelectCategory={setSettingsCategory}
              onBackToWorkspace={() => setActiveMode("workspace")}
            />

            {/* 右侧大圆角容器 - 设置项控制台 */}
            <div className="rounded-canvas">
              <SettingsConsole
                activeCategory={settingsCategory}
                models={models}
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                onSaveModel={handleSaveModel}
                onDeleteModel={handleDeleteModel}
                selectedTheme={selectedTheme}
                setSelectedTheme={setSelectedTheme}
                selectedPalette={selectedPalette}
                setSelectedPalette={setSelectedPalette}
                logoUrl={logoUrl}
                onLogoUpload={handleLogoUpload}
                onRemoveLogo={handleRemoveLogo}
                
                autoDownload={autoDownload}
                setAutoDownload={setAutoDownload}
                autoCloudSync={autoCloudSync}
                setAutoCloudSync={setAutoCloudSync}
                localStoragePath={localStoragePath}
                onOpenWorkspace={() => void handleOpenWorkspace()}
                defaultRatio={defaultRatio}
                setDefaultRatio={setDefaultRatio}
                agentStepLimits={agentStepLimits}
                setAgentStepLimits={setAgentStepLimits}
                agentGatewayPreferences={agentGatewayPreferences}
                setAgentGatewayPreferences={setAgentGatewayPreferences}
                
                themeMode={themeMode}
                setThemeMode={setThemeMode}
                borderRadiusScale={borderRadiusScale}
                setBorderRadiusScale={setBorderRadiusScale}
                colorContrastOffset={colorContrastOffset}
                setColorContrastOffset={setColorContrastOffset}
                onBackToWorkspace={() => setActiveMode("workspace")}
                triggerToast={triggerToast}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
