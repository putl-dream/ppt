import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Presentation } from "@shared/presentation";
import type { SessionBootstrap, SessionSummary } from "@shared/session";
import {
  getWorkspaceLabel,
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from "@shared/workspace";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import { useProjectStore } from "../../components/project-store";
import {
  clearAllDisplayCardManagers,
  getPersistedDisplayCards,
  hydrateDisplayCardManagers,
  subscribeDisplayCardManagers,
} from "../../cards/display-card-managers";
import { toSessionChatMessages, type ChatMessage } from "../chatMessageRuntime";
import type {
  PresentationController,
  PresentationSyncOptions,
} from "../presentation/usePresentationController";

interface UseSessionControllerOptions {
  busy: boolean;
  presentation: Presentation | undefined;
  loadPresentation: PresentationController["loadPresentation"];
  resetPresentation: PresentationController["resetPresentation"];
  syncPresentation: (options?: PresentationSyncOptions) => Promise<Presentation | undefined>;
  notify: (message: string) => void;
  markSettingsSaving: () => void;
  resetRequest: () => void;
}

export interface SessionController {
  startupError: string | undefined;
  sessions: SessionSummary[];
  activeSessionId: string;
  activeSessionIdRef: MutableRefObject<string>;
  sessionLoaded: boolean;
  isSessionSwitching: boolean;
  isDraftChat: boolean;
  setIsDraftChat: Dispatch<SetStateAction<boolean>>;
  workspacePath: string;
  localStoragePath: string;
  chatMessages: ChatMessage[];
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  applySessionState: (state: SessionBootstrap) => void;
  selectWorkspaceFolder: () => Promise<void>;
  openWorkspace: () => Promise<void>;
  newSession: () => Promise<void>;
  newSessionInWorkspace: (workspacePath: string) => void;
  selectSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export function useSessionController({
  busy,
  presentation,
  loadPresentation,
  resetPresentation,
  syncPresentation,
  notify,
  markSettingsSaving,
  resetRequest,
}: UseSessionControllerOptions): SessionController {
  const initializeProject = useProjectStore((state) => state.initializeProject);
  const hydrateProjectArtifacts = useProjectStore((state) => state.hydrateProjectArtifacts);
  const [startupError, setStartupError] = useState<string>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const activeSessionIdRef = useRef("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isSessionSwitching, setIsSessionSwitching] = useState(false);
  const [isDraftChat, setIsDraftChat] = useState(true);
  const [workspacePath, setWorkspacePath] = useState("");
  const [localStoragePath, setLocalStoragePath] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const enterDraftChat = useCallback((workspaceDir?: string) => {
    activeSessionIdRef.current = "";
    clearAllDisplayCardManagers();
    setIsDraftChat(true);
    setActiveSessionId("");
    setChatMessages([]);
    resetPresentation();
    resetRequest();
    setWorkspacePath("");
    setLocalStoragePath(workspaceDir ? normalizeWorkspacePath(workspaceDir) : "");
    useProjectStore.getState().resetProject();
  }, [resetPresentation, resetRequest]);

  const applySessionState = useCallback((state: SessionBootstrap) => {
    setSessions(state.sessions);
    if (!state.activeSession) {
      enterDraftChat();
      setSessionLoaded(true);
      return;
    }

    const snapshot = state.activeSession;
    activeSessionIdRef.current = snapshot.session.id;
    hydrateDisplayCardManagers(snapshot.displayCards);
    setIsDraftChat(snapshot.messages.length === 0);
    setActiveSessionId(snapshot.session.id);
    loadPresentation(snapshot.presentation);
    setChatMessages(snapshot.messages);
    resetRequest();
    setSessionLoaded(true);

    const resolvedWorkspace = snapshot.project?.rootPath
      ? resolveWorkspacePath({
          workspacePath: snapshot.session.workspacePath,
          projectRootPath: snapshot.project.rootPath,
        })
      : undefined;
    setWorkspacePath(resolvedWorkspace ?? "");
    setLocalStoragePath(resolvedWorkspace ?? "");

    initializeProject(snapshot.session.id, snapshot.session.title, snapshot.project?.artifacts);
    void hydrateProjectArtifacts(snapshot.session.id).catch((error) => {
      console.error("加载项目产物失败:", error);
      notify(formatPublicErrorMessage(error, "加载项目内容失败，请重试。"));
    });
    void syncPresentation({
      preferredSlideId: snapshot.presentation.slides[0]?.id,
      openMirror: snapshot.presentation.revision > 0,
    });
  }, [
    enterDraftChat,
    hydrateProjectArtifacts,
    initializeProject,
    loadPresentation,
    notify,
    resetRequest,
    syncPresentation,
  ]);

  useEffect(() => {
    if (!window.desktopApi) {
      setStartupError("桌面通信桥接加载失败，请重启应用程序。");
      return;
    }
    void window.desktopApi
      .getSessionState()
      .then(applySessionState)
      .catch((error: unknown) => {
        setStartupError(formatPublicErrorMessage(error, "无法打开本地工作区。"));
      });
  }, [applySessionState]);

  useEffect(() => {
    if (!presentation || !activeSessionId) return;
    setSessions((current) => current.map((session) =>
      session.id === activeSessionId
        ? {
            ...session,
            title: presentation.title || session.title,
            slideCount: presentation.slides.length,
            revision: presentation.revision,
          }
        : session,
    ));
  }, [activeSessionId, presentation]);

  useEffect(() => {
    if (!sessionLoaded || !activeSessionId) return;
    const messages = toSessionChatMessages(chatMessages);
    const timer = window.setTimeout(() => {
      void window.desktopApi.saveSessionMessages(activeSessionId, messages).catch((error) => {
        console.error("保存会话消息失败:", error);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, chatMessages, sessionLoaded]);

  useEffect(() => {
    if (!sessionLoaded || !activeSessionId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const persistCards = () => {
      if (activeSessionIdRef.current !== activeSessionId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void window.desktopApi
          .saveSessionDisplayCards(activeSessionId, getPersistedDisplayCards())
          .catch((error) => console.error("保存会话卡片失败:", error));
      }, 250);
    };
    const unsubscribe = subscribeDisplayCardManagers(persistCards);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [activeSessionId, sessionLoaded]);

  const selectWorkspaceFolder = useCallback(async () => {
    if (busy) {
      notify("当前任务执行中，请稍后再选择目录");
      return;
    }
    try {
      const selectedPath = await window.desktopApi.selectDirectory(
        localStoragePath || workspacePath || undefined,
      );
      if (!selectedPath) return;
      const normalized = normalizeWorkspacePath(selectedPath);
      setLocalStoragePath(normalized);
      notify(`已选择目录：${getWorkspaceLabel(normalized)}`);
    } catch (error) {
      notify(formatPublicErrorMessage(error, "选择目录失败，请重试。"));
    }
  }, [busy, localStoragePath, notify, workspacePath]);

  const openWorkspace = useCallback(async () => {
    if (busy) {
      notify("当前任务执行中，请稍后再打开目录");
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
      markSettingsSaving();
      notify(`已打开项目目录：${getWorkspaceLabel(selectedPath)}`);
    } catch (error) {
      setSessionLoaded(true);
      notify(formatPublicErrorMessage(error, "打开项目目录失败，请重试。"));
    }
  }, [
    applySessionState,
    busy,
    localStoragePath,
    markSettingsSaving,
    notify,
    workspacePath,
  ]);

  const newSession = useCallback(async () => {
    if (busy) {
      notify("当前任务执行中，请稍后再新建会话");
      return;
    }
    try {
      const selectedPath = await window.desktopApi.selectDirectory(
        localStoragePath || workspacePath || undefined,
      );
      if (!selectedPath) return;
      enterDraftChat(normalizeWorkspacePath(selectedPath));
    } catch (error) {
      notify(formatPublicErrorMessage(error, "选择项目目录失败，请重试。"));
    }
  }, [busy, enterDraftChat, localStoragePath, notify, workspacePath]);

  const newSessionInWorkspace = useCallback((targetWorkspacePath: string) => {
    if (busy) {
      notify("当前任务执行中，请稍后再新建会话");
      return;
    }
    enterDraftChat(targetWorkspacePath);
  }, [busy, enterDraftChat, notify]);

  const selectSession = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId || isSessionSwitching) return;
    if (busy) {
      notify("当前任务执行中，请稍后再切换会话");
      return;
    }
    setIsSessionSwitching(true);
    try {
      applySessionState(await window.desktopApi.selectSession(sessionId));
      notify("已恢复会话内容");
    } catch (error) {
      notify(formatPublicErrorMessage(error, "切换会话失败，请重试。"));
    } finally {
      setIsSessionSwitching(false);
    }
  }, [activeSessionId, applySessionState, busy, isSessionSwitching, notify]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (busy) {
      notify("当前任务执行中，请稍后再删除会话");
      return;
    }
    try {
      const state = await window.desktopApi.deleteSession(sessionId);
      const isDeleted = !state.sessions.some((session) => session.id === sessionId);
      applySessionState(state);
      if (isDeleted) notify("会话已删除");
    } catch (error) {
      notify(formatPublicErrorMessage(error, "删除会话失败，请重试。"));
    }
  }, [applySessionState, busy, notify]);

  return {
    startupError,
    sessions,
    activeSessionId,
    activeSessionIdRef,
    sessionLoaded,
    isSessionSwitching,
    isDraftChat,
    setIsDraftChat,
    workspacePath,
    localStoragePath,
    chatMessages,
    setChatMessages,
    applySessionState,
    selectWorkspaceFolder,
    openWorkspace,
    newSession,
    newSessionInWorkspace,
    selectSession,
    deleteSession,
  };
}
