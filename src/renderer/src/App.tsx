import { useEffect, useState } from "react";
import type { AgentApprovalRequest } from "@shared/ipc";
import type { Presentation, SlideElement } from "@shared/presentation";
import { LeftPanel } from "./components/LeftPanel";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { PPTMirror } from "./components/PPTMirror";
import { SettingsSidebar } from "./components/SettingsSidebar";
import { SettingsConsole } from "./components/SettingsConsole";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thought?: string[];
  progress?: number;
  approval?: AgentApprovalRequest;
}

interface SessionItem {
  id: string;
  title: string;
  timestamp: string;
  slideCount: number;
  revision: number;
}

export function App() {
  const [presentation, setPresentation] = useState<Presentation>();
  const [startupError, setStartupError] = useState<string>();
  
  // UI 状态控制
  const [selectedSlideId, setSelectedSlideId] = useState<string>("");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [maxRevision, setMaxRevision] = useState(0);

  // 双模态同构布局模式控制
  const [activeMode, setActiveMode] = useState<"workspace" | "settings">("workspace");
  const [settingsCategory, setSettingsCategory] = useState<"profile" | "workflow" | "appearance">("profile");

  // 常规设置：常规/工作流与文件系统
  const [autoDownload, setAutoDownload] = useState(true);
  const [autoCloudSync, setAutoCloudSync] = useState(false);
  const [localStoragePath, setLocalStoragePath] = useState("D:/Coding/ppt/workspace");
  const [defaultRatio, setDefaultRatio] = useState<"16:9" | "4:3">("16:9");

  // 外观定制与视效控制阀
  const [themeMode, setThemeMode] = useState<"light" | "dark" | "system">("light");
  const [borderRadiusScale, setBorderRadiusScale] = useState(1.0);
  const [colorContrastOffset, setColorContrastOffset] = useState(0);
  const [computedTheme, setComputedTheme] = useState<"light" | "dark">("light");

  // 编排属性
  const [selectedTheme, setSelectedTheme] = useState<string>("nordic");
  const [selectedPalette, setSelectedPalette] = useState<string>("cyan");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("gpt-5.5");
  const [apiKey, setApiKey] = useState<string>("");

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

  // 对话流与 Agent 编排状态
  const [request, setRequest] = useState("创建一份智能硬件市场推广策划大纲");
  const [approval, setApproval] = useState<AgentApprovalRequest>();
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "init",
      role: "assistant",
      content: "您好！我是您的 Agent PPT 协同设计助手。请告诉我想制作什么样的幻灯片（例如：'添加一页关于竞品分析的幻灯片' 或 '制作一份技术战略演示文稿'），我将为您生成排版指令方案。",
    },
  ]);
  const [thoughtProcess, setThoughtProcess] = useState<string[]>([]);
  const [thoughtProgress, setThoughtProgress] = useState(0);
  const [highlightSlideId, setHighlightSlideId] = useState<string | null>(null);

  // 会话列表与缓存
  const [sessions, setSessions] = useState<SessionItem[]>([
    {
      id: "session-1",
      title: "关于智能硬件的推广大纲",
      timestamp: "00:00:01",
      slideCount: 1,
      revision: 0,
    },
  ]);
  const [activeSessionId, setActiveSessionId] = useState("session-1");
  const [sessionPresentationCache, setSessionPresentationCache] = useState<Record<string, Presentation>>({});

  // 全局焦点模式快捷键监听 (Cmd+Option+F 或 Ctrl+Alt+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const pressedF = e.key.toLowerCase() === "f";
      const matches = isMac
        ? e.metaKey && e.altKey && pressedF
        : e.ctrlKey && e.altKey && pressedF;

      if (matches) {
        e.preventDefault();
        setIsFocusMode((prev) => {
          const next = !prev;
          triggerToast(next ? "全局焦点模式已开启 (侧边栏已隐藏)" : "全局焦点模式已关闭");
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 获取初始 PPT 数据并初始化缓存
  useEffect(() => {
    if (!window.desktopApi) {
      setStartupError("桌面通信桥接加载失败，请重启应用程序。");
      return;
    }
    void window.desktopApi
      .getPresentation()
      .then((pres) => {
        setPresentation(pres);
        if (pres.slides.length > 0) {
          setSelectedSlideId(pres.slides[0].id);
        }
      })
      .catch((error: unknown) => {
        setStartupError(error instanceof Error ? error.message : "无法打开本地工作区。");
      });
  }, []);

  // 同步历史修改快照与会话缓存
  useEffect(() => {
    if (presentation && activeSessionId) {
      // 写入对应会话的快照缓存
      setSessionPresentationCache((prev) => ({
        ...prev,
        [activeSessionId]: presentation,
      }));

      // 更新会话列表元信息
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

  // 新建会话分支
  const handleNewSession = () => {
    const newId = `session-${crypto.randomUUID()}`;
    const newSession: SessionItem = {
      id: newId,
      title: `新幻灯片会话 ${sessions.length + 1}`,
      timestamp: new Date().toLocaleTimeString(),
      slideCount: 1,
      revision: 0,
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);

    if (presentation) {
      const starter: Presentation = {
        id: crypto.randomUUID(),
        title: newSession.title,
        revision: 0,
        slides: [
          {
            id: crypto.randomUUID(),
            title: "新建会话封面",
            elements: [
              {
                id: crypto.randomUUID(),
                type: "text",
                x: 120,
                y: 220,
                width: 1040,
                height: 180,
                text: newSession.title,
                fontSize: 52,
              },
            ],
          },
        ],
      };
      setPresentation(starter);
      setSelectedSlideId(starter.slides[0].id);
      setSelectedElementId(null);
    }

    setChatMessages([
      {
        id: "init",
        role: "assistant",
        content: `您好！已为您开启新的会话分支【${newSession.title}】。请告诉我您的排版大纲，我将为您生成排版命令。`,
      },
    ]);
    triggerToast("➕ 已开启新会话分支");
  };

  // 切换会话分支并载入对应 presentation 数据
  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    const cached = sessionPresentationCache[sessionId];
    if (cached) {
      setPresentation(cached);
      if (cached.slides.length > 0) {
        setSelectedSlideId(cached.slides[0].id);
      }
      setSelectedElementId(null);
    }
    setChatMessages([
      {
        id: "init",
        role: "assistant",
        content: "已切回到当前会话分支，大纲状态与幻灯片历史已对齐。请继续下达微调指令。",
      },
    ]);
    triggerToast("📂 已载入会话分支数据");
  };

  // 提交意图大纲到 Agent
  async function startAgent(customRequest?: string) {
    const activeRequest = customRequest || request;
    if (!activeRequest.trim() || busy) return;

    setBusy(true);
    setApproval(undefined);
    setThoughtProgress(5);
    setThoughtProcess(["解析用户指令与语义意图...", "提取排版策略元数据..."]);

    const userMsgId = crypto.randomUUID();
    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: activeRequest },
    ]);
    
    if (!customRequest) {
      setRequest("");
    }

    // 进度条模拟
    const thoughtInterval = setInterval(() => {
      setThoughtProgress((p) => {
        if (p >= 90) {
          clearInterval(thoughtInterval);
          return 90;
        }
        return p + Math.floor(Math.random() * 15) + 5;
      });
    }, 450);

    const steps = [
      "分析意图并生成排版指令中...",
      "连接 LangGraph 智能体节点链...",
      "计算幻灯片布局安全边界...",
      "校验排版指令与坐标合理性...",
      "构建修改指令确认单...",
    ];

    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      if (stepIdx < steps.length) {
        setThoughtProcess((prev) => [...prev, steps[stepIdx]]);
        stepIdx++;
      } else {
        clearInterval(stepInterval);
      }
    }, 600);

    try {
      // 提交到后端
      const provider = selectedModel.startsWith("claude-") ? "anthropic" : "openai";
      const result = await window.desktopApi.startAgentRun(activeRequest, {
        provider,
        model: selectedModel,
        apiKey: apiKey.trim() || undefined,
      });
      clearInterval(thoughtInterval);
      clearInterval(stepInterval);
      setThoughtProgress(100);

      if (result.status === "approval-required") {
        setApproval(result.approval);
        setChatMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `我已为您草拟了演示文稿的更新方案，请在中间对话区查看排版指令列表进行确认：`,
            thought: [...steps, "指令规划生成完毕，等待审批。"],
            approval: result.approval,
          },
        ]);
        triggerToast("⚠️ AI 已提出排版变更方案，请及时进行审核！");
      } else {
        setPresentation(result.presentation);
        if (result.presentation.slides.length > 0) {
          const lastId = result.presentation.slides[result.presentation.slides.length - 1].id;
          setSelectedSlideId(lastId);
          setHighlightSlideId(lastId); // 自动高亮镜像
          setTimeout(() => setHighlightSlideId(null), 2500);
        }
        setChatMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `排版指令已执行完毕，修改已成功应用！`,
          },
        ]);
        triggerToast("✨ 演示文稿已成功更新！");
      }
    } catch (err) {
      clearInterval(thoughtInterval);
      clearInterval(stepInterval);
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `执行指令时发生错误：${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setBusy(false);
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

      if (result.status !== "approval-required") {
        setPresentation(result.presentation);
        setApproval(undefined);
        if (result.presentation.slides.length > 0 && approved) {
          const lastId = result.presentation.slides[result.presentation.slides.length - 1].id;
          setSelectedSlideId(lastId);
          setHighlightSlideId(lastId);
          setTimeout(() => setHighlightSlideId(null), 2500);
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

  // 修改 AI 产生的信息大纲文本
  const handleUpdateMessageContent = (msgId: string, newContent: string) => {
    setChatMessages((prev) =>
      prev.map((msg) => (msg.id === msgId ? { ...msg, content: newContent } : msg))
    );
    triggerToast("✏️ 大纲文本修改已更新");
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
      <div className={`workspace-container ${isFocusMode ? "focus-mode" : ""} mode-${activeMode}`}>
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
            />

            {/* 右侧大圆角容器 - Agent 协作与实时画布 */}
            <div className="rounded-canvas">
              <div className="workspace-canvas-content">
                {/* 中间栏：AI Chat 对话与大纲核心区 */}
                <ChatWorkspace
                  chatMessages={chatMessages}
                  thoughtProcess={thoughtProcess}
                  thoughtProgress={thoughtProgress}
                  request={request}
                  onChangeRequest={setRequest}
                  onSubmitRequest={() => void startAgent()}
                  busy={busy}
                  approval={approval}
                  onResolveApproval={resolveApproval}
                  themeMode={computedTheme}
                  onToggleThemeMode={() => setThemeMode(computedTheme === "light" ? "dark" : "light")}
                  isFocusMode={isFocusMode}
                  onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
                  onUndo={() => void handleHistory("undo")}
                  onRedo={() => void handleHistory("redo")}
                  canUndo={presentation.revision > 0}
                  canRedo={presentation ? presentation.revision < maxRevision : false}
                  selectedSlideIndex={activeSlideIndexValue}
                  onClearContextTag={() => setSelectedSlideId("")}
                  onUpdateMessageContent={handleUpdateMessageContent}
                  onProposePrompt={handleSuggestPrompt}
                />

                {/* 右栏：PPT 纵向滚动镜像 */}
                <PPTMirror
                  presentation={presentation}
                  selectedSlideId={selectedSlideId}
                  onSelectSlide={(id) => {
                    setSelectedSlideId(id);
                    setSelectedElementId(null);
                  }}
                  selectedTheme={selectedTheme}
                  selectedPalette={selectedPalette}
                  logoUrl={logoUrl}
                  onOptimizePresentation={handleOptimizePresentationLocally}
                  highlightSlideId={highlightSlideId}
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
                apiKey={apiKey}
                setApiKey={setApiKey}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
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
