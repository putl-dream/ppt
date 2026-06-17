import { useEffect, useRef, useState } from "react";
import type {
  AgentApprovalRequest,
  AgentOutlineRequest,
  AgentRunResult,
  AgentStreamEvent,
} from "@shared/ipc";
import type { Presentation, SlideElement } from "@shared/presentation";
import {
  createSessionPresentation,
  createWelcomeMessage,
  type SessionBootstrap,
  type SessionChatMessage,
  type SessionSummary,
} from "@shared/session";
import { findRecoverableOutlineConversation } from "@shared/session-recovery";
import { LeftPanel } from "./components/LeftPanel";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { PPTMirror } from "./components/PPTMirror";
import { SettingsSidebar } from "./components/SettingsSidebar";
import { SettingsConsole } from "./components/SettingsConsole";

// Project Pipeline Components & Store
import { useProjectStore } from "./components/project-store";
import { BriefFormCollector } from "./components/BriefFormCollector";
import { DraggableOutlineTree } from "./components/DraggableOutlineTree";
import { ResearchNotesCollector } from "./components/ResearchNotesCollector";
import { StoryboardGrid } from "./components/StoryboardGrid";
import { DesignThemeSelector } from "./components/DesignThemeSelector";
import { DiffReviewZone } from "./components/DiffReviewZone";
import { ContextualAgentPanel } from "./components/ContextualAgentPanel";
import { CanvasArea } from "./components/CanvasArea";
import {
  DEFAULT_MODELS,
  MODEL_STORAGE_KEY,
  SELECTED_MODEL_STORAGE_KEY,
  loadManagedModels,
  toAgentModelSettings,
  type ManagedModel,
} from "./modelCatalog";

type ChatMessage = SessionChatMessage;

export function App() {
  const initializeProject = useProjectStore((state) => state.initializeProject);
  const currentStage = useProjectStore((state) => state.currentStage);
  const activeProject = useProjectStore((state) => state.activeProject);
  const proposePatch = useProjectStore((state) => state.proposePatch);
  const proposedPatch = useProjectStore((state) => state.proposedPatch);

  const [presentation, setPresentation] = useState<Presentation>();
  const [startupError, setStartupError] = useState<string>();
  
  // UI 状态控制
  const [selectedSlideId, setSelectedSlideId] = useState<string>("");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isMirrorOpen, setIsMirrorOpen] = useState(false);
  const [isMirrorExpanded, setIsMirrorExpanded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [maxRevision, setMaxRevision] = useState(0);

  // 双模态同构布局模式控制
  const [activeMode, setActiveMode] = useState<"workspace" | "settings">("workspace");
  const [settingsCategory, setSettingsCategory] = useState<"profile" | "models" | "workflow" | "appearance">("profile");

  // 常规设置：常规/工作流与文件系统
  const [autoDownload, setAutoDownload] = useState(true);
  const [autoCloudSync, setAutoCloudSync] = useState(false);
  const [localStoragePath, setLocalStoragePath] = useState("D:/Coding/ppt/workspace");
  const [defaultRatio, setDefaultRatio] = useState<"16:9" | "4:3">("16:9");
  const [executionStrategy, setExecutionStrategy] = useState<"REQUEST_APPROVAL" | "AUTO">("REQUEST_APPROVAL");

  // 外观定制与视效控制阀
  const [themeMode, setThemeMode] = useState<"light" | "dark" | "system">("light");
  const [borderRadiusScale, setBorderRadiusScale] = useState(1.0);
  const [colorContrastOffset, setColorContrastOffset] = useState(0);
  const [computedTheme, setComputedTheme] = useState<"light" | "dark">("light");

  // 编排属性
  const [selectedTheme, setSelectedTheme] = useState<string>("nordic");
  const [selectedPalette, setSelectedPalette] = useState<string>("cyan");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
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
      const appL = Math.max(2, 5 - colorContrastOffset);
      const canvasL = Math.min(25, 8 + colorContrastOffset);
      document.documentElement.style.setProperty("--bg-app", `hsl(220, 30%, ${appL}%)`);
      document.documentElement.style.setProperty("--bg-canvas", `hsl(220, 29%, ${canvasL}%)`);
    } else {
      const appL = Math.min(99, 95 + colorContrastOffset);
      const canvasL = Math.max(85, 93 - colorContrastOffset);
      document.documentElement.style.setProperty("--bg-app", `hsl(220, 16%, ${appL}%)`);
      document.documentElement.style.setProperty("--bg-canvas", `hsl(220, 15%, ${canvasL}%)`);
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
  const [request, setRequest] = useState("创建一份智能硬件市场推广策划大纲");
  const [approval, setApproval] = useState<AgentApprovalRequest>();
  const [outlineRequest, setOutlineRequest] = useState<AgentOutlineRequest>();
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [thoughtProcess, setThoughtProcess] = useState<string[]>([]);
  const [thoughtProgress, setThoughtProgress] = useState(0);
  const [agentActivityMode, setAgentActivityMode] = useState<"idle" | "request" | "workflow">("idle");
  const [highlightSlideId, setHighlightSlideId] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunStepsRef = useRef<string[]>([]);
  const streamMessageIdsRef = useRef(new Map<string, string>());
  const statusTypingTimerRef = useRef<number | null>(null);

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
        let visibleLength = 1;
        setThoughtProcess([event.message.slice(0, visibleLength)]);
        statusTypingTimerRef.current = window.setInterval(() => {
          visibleLength += 1;
          setThoughtProcess([event.message.slice(0, visibleLength)]);
          if (visibleLength >= event.message.length) stopStatusTyping();
        }, 28);
        return;
      }

      if (event.type === "workflow-progress") {
        stopStatusTyping();
        setAgentActivityMode("workflow");
        activeRunStepsRef.current = [...activeRunStepsRef.current, event.message];
        setThoughtProcess(activeRunStepsRef.current);
        setThoughtProgress(event.progress);
        return;
      }

      stopStatusTyping();
      setAgentActivityMode("idle");
      setThoughtProcess([]);
      setThoughtProgress(0);
      let messageId = streamMessageIdsRef.current.get(event.runId);
      if (!messageId) {
        messageId = crypto.randomUUID();
        streamMessageIdsRef.current.set(event.runId, messageId);
        setChatMessages((prev) => [
          ...prev,
          { id: messageId!, role: "assistant", content: event.delta },
        ]);
        return;
      }

      setChatMessages((prev) => prev.map((message) =>
        message.id === messageId
          ? { ...message, content: `${message.content}${event.delta}` }
          : message,
      ));
    });
    return () => {
      stopStatusTyping();
      unsubscribe();
    };
  }, []);

  // 会话状态由 Electron 主进程持久化，渲染进程只保留当前快照
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isDraftSession, setIsDraftSession] = useState(false);

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

  const applySessionState = (state: SessionBootstrap) => {
    const snapshot = state.activeSession;
    setSessions(state.sessions);
    setActiveSessionId(snapshot.session.id);
    setPresentation(snapshot.presentation);
    setChatMessages(snapshot.messages);
    const latestMessage = snapshot.messages.at(-1);
    setApproval(latestMessage?.approval);
    setOutlineRequest(findRecoverableOutlineConversation(snapshot.messages)?.outlineRequest);
    setRequest("");
    setSelectedSlideId(snapshot.presentation.slides[0]?.id ?? "");
    setSelectedElementId(null);
    setMaxRevision(snapshot.presentation.revision);
    setSessionLoaded(true);
    setIsDraftSession(false);
    setIsMirrorOpen(snapshot.presentation.revision > 0);

    // Initialize the project store
    initializeProject(snapshot.session.id, snapshot.session.title, snapshot.project?.artifacts);
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
                updatedAt: new Date().toISOString(),
              }
            : s
        )
      );
    }
  }, [presentation, activeSessionId]);

  // 对话内容采用短防抖保存，避免流式 UI 更新造成频繁磁盘写入
  useEffect(() => {
    if (!sessionLoaded || !activeSessionId) return;
    const messages: SessionChatMessage[] = chatMessages.map(
      ({ id, role, content, thought, progress, approval, outlineRequest }) => ({
        id,
        role,
        content,
        thought,
        progress,
        approval,
        outlineRequest,
      }),
    );
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

  // 新建仅打开草稿窗口；首次发送消息后才会创建持久化会话
  const handleNewSession = () => {
    if (busy) {
      triggerToast("当前任务执行中，请稍后再新建会话");
      return;
    }
    const presentation = createSessionPresentation("新演示文稿");
    setIsDraftSession(true);
    setActiveSessionId("");
    setPresentation(presentation);
    setChatMessages([createWelcomeMessage()]);
    setApproval(undefined);
    setOutlineRequest(undefined);
    setRequest("");
    setSelectedSlideId(presentation.slides[0]?.id ?? "");
    setSelectedElementId(null);
    setMaxRevision(0);
    setSessionLoaded(true);
    setIsMirrorOpen(false);
    triggerToast("已打开新会话草稿，发送消息后才会保存");

    // Initialize the project store with a draft project
    initializeProject("draft_id", "新演示文稿");
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

  function applyAgentResult(result: AgentRunResult, steps: string[], runId?: string) {
    if (result.status === "chat") {
      setOutlineRequest(undefined);
      const messageId = runId ? streamMessageIdsRef.current.get(runId) : undefined;
      if (messageId) {
        setChatMessages((prev) => prev.map((message) =>
          message.id === messageId ? { ...message, content: result.message } : message,
        ));
      } else {
        setChatMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: result.message },
        ]);
      }
      return;
    }

    if (result.status === "outline-required") {
      setOutlineRequest(result.outlineRequest);
      setApproval(undefined);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.outlineRequest.message,
          thought: steps,
          outlineRequest: result.outlineRequest,
        },
      ]);
      triggerToast("大纲已整理，请确认或继续调整");
      return;
    }

    setOutlineRequest(undefined);
    if (result.status === "approval-required") {
      setApproval(result.approval);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "已根据确认的大纲生成排版方案，请审核指令后执行。",
          thought: steps,
          approval: result.approval,
        },
      ]);
      triggerToast("AI 已提出排版变更方案，请进行审核");
      return;
    }

    setPresentation(result.presentation);
    if (result.presentation.slides.length > 0) {
      const lastId = result.presentation.slides[result.presentation.slides.length - 1].id;
      setSelectedSlideId(lastId);
      setHighlightSlideId(lastId);
      setTimeout(() => setHighlightSlideId(null), 2500);
    }
    setIsMirrorOpen(true);
    setChatMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.status === "rejected" ? "已放弃排版变更提案。" : "已根据确认的大纲生成并应用演示文稿。",
      },
    ]);
    triggerToast(result.status === "rejected" ? "变更已取消" : "演示文稿已成功更新");
  }

  // 提交需求或继续当前大纲对话
  async function startAgent(customRequest?: string, isEditOfMsgId?: string) {
    const activeRequest = customRequest || request;
    if (!activeRequest.trim() || busy) return;

    setBusy(true);
    if (isDraftSession) {
      try {
        applySessionState(await window.desktopApi.createSession());
      } catch (error) {
        setBusy(false);
        triggerToast(error instanceof Error ? error.message : "创建会话失败");
        return;
      }
    }

    // “输入即配置”数据打包，输出复合 Context 对象给控制台并进行请求
    const activeStage = useProjectStore.getState().currentStage;
    const activeProjectObj = useProjectStore.getState().activeProject;
    const briefContent = activeProjectObj?.artifacts.brief.content || "";
    const outlineContent = activeProjectObj?.artifacts.outline.content || "";
    const researchContent = activeProjectObj?.artifacts.research.content || "";
    const designContent = activeProjectObj?.artifacts.design.content || "";

    console.log("Packaging Agent context payload (File-Context Aware):", {
      sessionId: activeSessionId,
      projectId: activeProjectObj?.id || "default",
      activeStage,
      command: activeRequest,
      contextFiles: [
        { path: "brief.md", content: briefContent },
        { path: "outline.md", content: outlineContent },
        { path: "research/notes.md", content: researchContent },
        { path: "design/theme.json", content: designContent },
      ],
      editorContext: {
        currentSlideId: selectedSlideId || undefined,
        selectedElementIds: selectedElementId ? [selectedElementId] : [],
      }
    });

    setApproval(undefined);
    setThoughtProgress(0);
    setThoughtProcess([]);
    setAgentActivityMode("idle");
    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    activeRunStepsRef.current = [];

    if (isEditOfMsgId) {
      setChatMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === isEditOfMsgId);
        if (idx === -1) return prev;
        const truncated = prev.slice(0, idx + 1);
        truncated[idx] = { ...truncated[idx], content: activeRequest };
        return truncated;
      });
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

    let useOutlineRequest = outlineRequest;
    if (isEditOfMsgId) {
      setOutlineRequest(undefined);
      useOutlineRequest = undefined;
    }

    try {
      const result = useOutlineRequest
        ? await window.desktopApi.continueAgentRun(
          useOutlineRequest.threadId,
          activeRequest,
          runId,
          {
            currentSlideId: selectedSlideId || undefined,
            selectedElementIds: selectedElementId ? [selectedElementId] : [],
          },
        )
        : await window.desktopApi.startAgentRun(
          activeRequest,
          selectedModel ? toAgentModelSettings(selectedModel) : undefined,
          executionStrategy,
          runId,
          {
            currentSlideId: selectedSlideId || undefined,
            selectedElementIds: selectedElementId ? [selectedElementId] : [],
          },
        );
      applyAgentResult(result, activeRunStepsRef.current, runId);

      // Simulate file_patch triggering for demonstration
      if (result.status === "outline-required") {
        const store = useProjectStore.getState();
        store.proposePatch({
          targetFile: "outline.md",
          op: "replace",
          patch: "...",
          contentBefore: store.activeProject?.artifacts.outline.content || "",
          contentAfter: `# 演示大纲 (已优化)\n\n## 1. 行业背景与痛点 [预计 2 页]\n- 2026年智能硬件行业增速放缓\n- 用户获取成本过高，红利期消退\n\n## 2. 解决方案策划 [预计 1 页]\n- 引入云端协同技术\n- 优化交付链条，提高响应效率\n`,
          summary: "AI 助手已优化大纲结构，细化了行业背景痛点，并添加了云端协同解决方案。"
        });
      }
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
      streamMessageIdsRef.current.delete(runId);
      if (statusTypingTimerRef.current !== null) {
        window.clearInterval(statusTypingTimerRef.current);
        statusTypingTimerRef.current = null;
      }
      setBusy(false);
      setAgentActivityMode("idle");
      setThoughtProcess([]);
      setThoughtProgress(0);
    }
  }

  async function confirmOutline() {
    if (!outlineRequest?.outline || busy) return;
    setBusy(true);
    setThoughtProgress(0);
    setThoughtProcess([]);
    setAgentActivityMode("idle");
    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    activeRunStepsRef.current = [];
    try {
      const result = await window.desktopApi.confirmAgentOutline(outlineRequest.threadId, runId);
      applyAgentResult(result, activeRunStepsRef.current, runId);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `确认大纲时发生错误：${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      activeRunIdRef.current = null;
      streamMessageIdsRef.current.delete(runId);
      if (statusTypingTimerRef.current !== null) {
        window.clearInterval(statusTypingTimerRef.current);
        statusTypingTimerRef.current = null;
      }
      setBusy(false);
      setAgentActivityMode("idle");
      setThoughtProcess([]);
      setThoughtProgress(0);
    }
  }

  // 推荐指令点击快捷处理
  const handleSuggestPrompt = (prompt: string) => {
    setRequest(prompt);
    void startAgent(prompt);
  };

  // 确认或拒绝变更方案
  async function resolveApproval(approved: boolean) {
    if (!approval || busy) return;
    setBusy(true);
    setThoughtProgress(20);
    setThoughtProcess([
      approved ? "正在应用排版变更方案到工作台..." : "正在撤销已草拟的排版方案...",
      "同步客户端最新数据状态...",
    ]);

    const progressInterval = setInterval(() => {
      setThoughtProgress((p) => (p >= 95 ? 95 : p + 25));
    }, 200);

    try {
      const result = await window.desktopApi.resumeAgentRun(approval.threadId, approved);
      clearInterval(progressInterval);
      setThoughtProgress(100);

      if (result.status === "completed" || result.status === "rejected") {
        setPresentation(result.presentation);
        setApproval(undefined);
        if (result.presentation.slides.length > 0 && approved) {
          const lastId = result.presentation.slides[result.presentation.slides.length - 1].id;
          setSelectedSlideId(lastId);
          setHighlightSlideId(lastId);
          setTimeout(() => setHighlightSlideId(null), 2500);
        }
        if (approved) {
          setIsMirrorOpen(true);
        }
        setChatMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: approved ? "已成功应用变更方案。" : "已放弃排版变更提案。",
          },
        ]);
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
      setThoughtProcess([]);
      setThoughtProgress(0);
    }
  }

  // 历史撤销重做操作
  async function handleHistory(action: "undo" | "redo") {
    setBusy(true);
    try {
      const updated = await window.desktopApi[action]();
      setPresentation(updated);
      if (updated.slides.length > 0) {
        setSelectedSlideId(updated.slides[updated.slides.length - 1].id);
      }
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
      const updated = await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "update-element",
        slideId,
        elementId,
        element: updatedElement,
      });
      setPresentation(updated);
      setHighlightSlideId(slideId); // 指令执行完成，高亮并平滑定位卡片
      setTimeout(() => setHighlightSlideId(null), 2000);
    } catch (err) {
      console.error("更新页面元素失败:", err);
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
      const updated = await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "update-element",
        slideId,
        elementId,
        element: updatedElement,
      });
      setPresentation(updated);
    } catch (err) {
      console.error("更新元素坐标失败:", err);
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
      const updated = await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "add-slide",
        slide: newSlide,
        index: presentation.slides.length,
      });
      setPresentation(updated);
      setSelectedSlideId(newSlideId);
      setSelectedElementId(null);
      setHighlightSlideId(newSlideId);
      setTimeout(() => setHighlightSlideId(null), 2500);
      triggerToast("➕ 已新建空白幻灯片");
    } catch (err) {
      console.error("新增幻灯片失败:", err);
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
      const updated = await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "add-slide",
        slide: duplicatedSlide,
        index: idx + 1,
      });
      setPresentation(updated);
      setSelectedSlideId(newSlideId);
      setSelectedElementId(null);
      setHighlightSlideId(newSlideId);
      setTimeout(() => setHighlightSlideId(null), 2500);
      triggerToast("📂 已复制当前幻灯片");
    } catch (err) {
      console.error("复制幻灯片失败:", err);
    }
  };

  const handleDeleteSlideLocally = async (slideId: string) => {
    if (!presentation) return;
    if (presentation.slides.length <= 1) return;
    const idx = presentation.slides.findIndex((s) => s.id === slideId);

    try {
      const updated = await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "remove-slide",
        slideId,
      });
      setPresentation(updated);
      const nextIdx = Math.max(0, idx - 1);
      if (updated.slides[nextIdx]) {
        setSelectedSlideId(updated.slides[nextIdx].id);
      }
      setSelectedElementId(null);
      triggerToast("🗑️ 已删除当前幻灯片");
    } catch (err) {
      console.error("删除幻灯片失败:", err);
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
      const updated = await window.desktopApi.executeCommand({
        id: crypto.randomUUID(),
        type: "add-element",
        slideId: selectedSlideId,
        element: newElement,
      });
      setPresentation(updated);
      setSelectedElementId(id);
      triggerToast("➕ 已新增画布元素");
    } catch (err) {
      console.error("添加元素失败:", err);
    }
  };

  // 全体一键 AI 美化
  const handleOptimizePresentationLocally = () => {
    setBusy(true);
    setThoughtProgress(10);
    setThoughtProcess([
      "分析整套幻灯片大纲框架...",
      "评估横向对齐率与风格模版协调性...",
      "重构全局坐标轴比例...",
    ]);

    const progressTimer = setInterval(() => {
      setThoughtProgress((p) => (p >= 85 ? 85 : p + 25));
    }, 300);

    setTimeout(() => {
      clearInterval(progressTimer);
      setThoughtProgress(100);
      
      if (presentation) {
        const updatedSlides = presentation.slides.map((s) => {
          const elements = s.elements.map((el) => {
            return {
              ...el,
              x: 120,
              width: 1040,
            };
          });
          return { ...s, elements };
        });
        setPresentation({ ...presentation, slides: updatedSlides });
      }
      setBusy(false);
      setThoughtProcess([]);
      triggerToast("✨ 全局演示文稿一键美化优化完成！");
    }, 1200);
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

  const handleSimulateLogoUpload = () => {
    setLogoUrl("https://www.google.com/images/branding/googlelogo/1x/googlelogo_light_color_272x92dp.png");
    triggerToast("🖼️ 品牌 Logo 已应用至演示文稿模板");
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
    triggerToast("🗑️ 品牌 Logo 已移除");
  };

  if (startupError) return <main className="loading error">{startupError}</main>;
  if (!presentation) return <main className="loading">正在打开本地演示文稿工作区...</main>;

  const selectedSlideIndex = presentation.slides.findIndex((s) => s.id === selectedSlideId);
  const activeSlideIndexValue = selectedSlideIndex >= 0 ? selectedSlideIndex : null;

  return (
    <main className={`app-shell ${computedTheme === "dark" ? "dark-theme" : ""}`}>
      {/* 渐变微光 */}
      <div className="app-bg-glow">
        <div className="glow-orb-1"></div>
        <div className="glow-orb-2"></div>
      </div>

      {/* 浮动提示通知 */}
      {toastMessage && <div className="floating-toast-alert">{toastMessage}</div>}

      {/* 三栏/双模态同构容器 */}
      <div className={`workspace-container mode-${activeMode}`}>
        {activeMode === "workspace" ? (
          <>
            {/* 左栏：会话管理列表 */}
            <LeftPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              onToggleSettings={() => {
                setActiveMode("settings");
                setSettingsCategory("profile");
              }}
              onDeleteSession={handleDeleteSession}
            />

            {/* 右侧大圆角容器 - Agent 协作与实时工作台 */}
            <div className="rounded-canvas" style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
              <div className="workspace-canvas-content" style={{ display: "flex", flex: 1, width: "100%", height: "100%", overflow: "hidden" }}>
                
                {/* 中间栏：各阶段的产物画布/编辑器区域 */}
                <div className="workspace-canvas-middle" style={{ flex: 1, height: "100%", position: "relative", display: "flex", flexDirection: "column", minWidth: 0 }}>
                  {proposedPatch && <DiffReviewZone />}
                  
                  {!proposedPatch && currentStage === "brief" && <BriefFormCollector />}
                  {!proposedPatch && currentStage === "outline" && <DraggableOutlineTree />}
                  {!proposedPatch && currentStage === "research" && <ResearchNotesCollector />}
                  {!proposedPatch && currentStage === "design" && <DesignThemeSelector />}
                  {!proposedPatch && currentStage === "slides" && <StoryboardGrid />}
                  
                  {!proposedPatch && currentStage === "deck" && (
                    <CanvasArea
                      presentation={presentation}
                      selectedSlideId={selectedSlideId}
                      onSelectSlide={(id) => {
                        setSelectedSlideId(id);
                        setSelectedElementId(null);
                      }}
                      selectedElementId={selectedElementId}
                      onSelectElement={setSelectedElementId}
                      selectedTheme={selectedTheme}
                      selectedPalette={selectedPalette}
                      logoUrl={logoUrl}
                      onUpdateElement={handleUpdateElement}
                      onUpdateElementPosition={handleUpdateElementPosition}
                      onAddSlide={handleAddSlideLocally}
                      onDuplicateSlide={handleDuplicateSlideLocally}
                      onDeleteSlide={handleDeleteSlideLocally}
                      onOptimizeSlide={handleOptimizePresentationLocally}
                      onAddElement={handleAddElementLocally}
                      isMirrorOpen={isMirrorOpen}
                      onToggleMirror={() => setIsMirrorOpen(!isMirrorOpen)}
                      themeMode={computedTheme}
                      onToggleThemeMode={() => setThemeMode(computedTheme === "light" ? "dark" : "light")}
                      onUndo={() => void handleHistory("undo")}
                      onRedo={() => void handleHistory("redo")}
                      canUndo={presentation.revision > 0}
                      canRedo={presentation ? presentation.revision < maxRevision : false}
                      onProposePrompt={handleSuggestPrompt}
                    />
                  )}
                </div>

                {/* 右栏：智能助手对话面板 */}
                <ContextualAgentPanel
                  chatMessages={chatMessages}
                  thoughtProcess={thoughtProcess}
                  thoughtProgress={thoughtProgress}
                  agentActivityMode={agentActivityMode}
                  request={request}
                  onChangeRequest={setRequest}
                  onSubmitRequest={() => void startAgent()}
                  busy={busy}
                  onConfirmOutline={() => void confirmOutline()}
                  onResolveApproval={resolveApproval}
                  
                  models={models}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                  executionStrategy={executionStrategy}
                  setExecutionStrategy={setExecutionStrategy}
                  localStoragePath={localStoragePath}
                  setLocalStoragePath={setLocalStoragePath}
                  triggerToast={triggerToast}
                  onUpdateMessageContent={handleUpdateMessageContent}
                  selectedSlideIndex={activeSlideIndexValue}
                  onClearContextTag={() => setSelectedSlideId("")}
                />

              </div>
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
                onSimulateLogoUpload={handleSimulateLogoUpload}
                onRemoveLogo={handleRemoveLogo}
                
                autoDownload={autoDownload}
                setAutoDownload={setAutoDownload}
                autoCloudSync={autoCloudSync}
                setAutoCloudSync={setAutoCloudSync}
                localStoragePath={localStoragePath}
                setLocalStoragePath={setLocalStoragePath}
                defaultRatio={defaultRatio}
                setDefaultRatio={setDefaultRatio}
                
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
