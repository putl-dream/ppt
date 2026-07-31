import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DESIGN_SYSTEM } from "@design-system";
import { getWorkspaceLabel } from "@shared/workspace";
import {
  setDisplayCardStatus,
  useNotificationCardManager,
} from "./cards/display-card-managers";
import { AppShell } from "./app/AppShell";
import { ProjectFilesView } from "./app/ProjectFilesView";
import { SettingsView } from "./app/SettingsView";
import { WorkspaceView } from "./app/WorkspaceView";
import { loadAppBootstrapSnapshot } from "./app/appBootstrap";
import { useNotificationCenter } from "./app/useNotificationCenter";
import { useSettingsController } from "./app/useSettingsController";
import { useWorkbenchLayout, type AppMode } from "./app/useWorkbenchLayout";
import { usePresentationController } from "./app/presentation/usePresentationController";
import { useDeckExport } from "./app/presentation/useDeckExport";
import { useSessionController } from "./app/session/useSessionController";
import { useAgentActivityStream } from "./app/agent/useAgentActivityStream";
import { useAgentRunController } from "./app/agent/useAgentRunController";
import { useDisplayEventActions } from "./app/cards/useDisplayEventActions";
import { confirmProjectFileNavigation } from "./app/project/projectFilesState";
import { useUserQuerySubmission } from "./app/useUserQuerySubmission";
import type { SettingsCategory } from "./settingsCategories";

export function App() {
  const [bootstrap] = useState(loadAppBootstrapSnapshot);
  const { message: toastMessage, notify } = useNotificationCenter();
  const presentationController = usePresentationController(notify);
  const {
    presentation,
    selectedSlideId,
    setSelectedSlideId,
    highlightSlideId,
    isMirrorVisible,
    isMirrorExpanded,
    isDeckPreviewOpen,
    loadPresentation,
    resetPresentation,
    syncPresentation,
    openMirror,
    closeMirror,
    toggleMirrorExpanded,
    openDeckPreview,
    closeDeckPreview,
    focusAffectedSlides,
  } = presentationController;

  const [activeMode, setActiveMode] = useState<AppMode>("workspace");
  const [projectFilesDirty, setProjectFilesDirty] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("models-list");
  const workbenchLayout = useWorkbenchLayout({
    activeMode,
    previewOpen: isMirrorVisible,
    previewExpanded: isMirrorExpanded,
  });
  const settings = useSettingsController(bootstrap, presentation, notify);
  const {
    logoUrl,
    selectedModelId,
    selectModel: setSelectedModelId,
    visibleModels,
  } = settings;

  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const resetRequest = useCallback(() => setRequest(""), []);
  const sessionController = useSessionController({
    busy,
    presentation,
    loadPresentation,
    resetPresentation,
    syncPresentation,
    notify,
    markSettingsSaving: settings.markSaving,
    resetRequest,
  });
  const {
    startupError,
    sessions,
    activeSessionId,
    activeSessionIdRef,
    sessionLoaded,
    isDraftChat,
    setIsDraftChat,
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
  } = sessionController;
  const { isExportingDeck, exportDeck } = useDeckExport({
    sessionId: activeSessionId,
    presentation,
    logoUrl,
    setChatMessages,
    notify,
  });

  const activity = useAgentActivityStream({
    activeSessionIdRef,
    setChatMessages,
  });
  const {
    activityTrace,
    agentRunPhase,
  } = activity;
  const agentRun = useAgentRunController({
    request,
    setRequest,
    busy,
    setBusy,
    activeSessionId,
    sessionLoaded,
    localStoragePath,
    selectedSlideId,
    chatMessages,
    setChatMessages,
    setIsDraftChat,
    applySessionState,
    syncPresentation,
    settings,
    activity,
    notify,
  });
  const {
    activeRunId,
    streamingMessageId,
    isCancellingRun,
    startAgent,
    cancelRun,
    retryMessage,
    suggestPrompt,
    resolveToolApproval,
  } = agentRun;

  const submitUserQuery = useUserQuerySubmission({
    request,
    busy,
    presentation,
    activeSessionId,
    setRequest,
    setChatMessages,
    openDeckPreview,
    notify,
    startAgent,
  });

  const displayActions = useDisplayEventActions({
    busy,
    setBusy,
    activeSessionId,
    setChatMessages,
    syncPresentation,
    activity,
    agentRun,
    notify,
  });

  const notificationCards = useNotificationCardManager((state) => state.cards);
  const lastNotificationEventIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const latest = [...notificationCards].reverse().find((card) =>
      card.status === "active" && card.event.kind === "notification.message"
    );
    if (
      !latest
      || latest.event.kind !== "notification.message"
      || latest.event.eventId === lastNotificationEventIdRef.current
    ) return;
    lastNotificationEventIdRef.current = latest.event.eventId;
    notify(latest.event.payload.message);
    setDisplayCardStatus(latest.event.eventId, "resolved");
  }, [notificationCards, notify]);

  if (startupError) return <main className="loading error">{startupError}</main>;
  if (!sessionLoaded) return <main className="loading">正在打开本地演示文稿工作区...</main>;

  const activeSessionTitle =
    sessions.find((session) => session.id === activeSessionId)?.title.trim()
    || presentation?.title?.trim()
    || (isDraftChat ? "AI 新建会话" : "当前对话");
  const confirmLeaveProjectFiles = () =>
    activeMode !== "files"
    || confirmProjectFileNavigation(
      projectFilesDirty,
      () => window.confirm("当前项目文件有未保存修改。要放弃草稿并离开吗？"),
    );
  const leftPanelProps = {
    sessions,
    activeSessionId,
    activeMode: activeMode === "files" ? "files" as const : "workspace" as const,
    onSelectSession: (sessionId: string) => {
      if (sessionId === activeSessionId || !confirmLeaveProjectFiles()) return;
      void selectSession(sessionId);
    },
    onNewSession: () => {
      if (!confirmLeaveProjectFiles()) return;
      setActiveMode("workspace");
      void newSession();
    },
    onNewSessionInWorkspace: (workspacePath: string) => {
      if (!confirmLeaveProjectFiles()) return;
      setActiveMode("workspace");
      void newSessionInWorkspace(workspacePath);
    },
    onOpenWorkspace: () => {
      if (confirmLeaveProjectFiles()) setActiveMode("workspace");
    },
    onOpenFiles: () => setActiveMode("files"),
    onToggleSettings: () => {
      if (!confirmLeaveProjectFiles()) return;
      setActiveMode("settings");
      setSettingsCategory("models-list");
    },
    onDeleteSession: (sessionId: string) => {
      if (sessionId === activeSessionId && !confirmLeaveProjectFiles()) return;
      void deleteSession(sessionId);
    },
  };

  return (
    <AppShell
      notificationMessage={toastMessage}
      workspaceClassName={workbenchLayout.workspaceClassName}
      workspaceStyle={workbenchLayout.workspaceStyle}
      showSidebarToggle={activeMode !== "settings"}
      sidebarCollapsed={workbenchLayout.isPrimarySidebarCollapsed}
      onToggleSidebar={workbenchLayout.togglePrimarySidebar}
    >
      {activeMode === "workspace" ? (
        <WorkspaceView
          leftPanelProps={leftPanelProps}
          chatWorkspaceProps={{
            isNewChat: isDraftChat,
            conversationTitle: activeSessionTitle,
            chatMessages,
            presentation,
            activityTrace,
            agentRunPhase,
            streamingMessageId,
            request,
            onChangeRequest: setRequest,
            onSubmitRequest: submitUserQuery,
            busy,
            onResolveApproval: displayActions.resolveApproval,
            onResolvePatch: (event, accepted) =>
              void displayActions.resolvePatch(event, accepted),
            onResolveQuestion: displayActions.resolveQuestion,
            onResolveToolApproval: (approvalId, approved) =>
              void resolveToolApproval(approvalId, approved),
            onReviseOutline: displayActions.reviseOutline,
            onOpenDeckPreview: openDeckPreview,
            onExportDeck: () => void exportDeck(),
            isExportingDeck,
            onFocusAffectedSlides: focusAffectedSlides,
            activeRunId,
            onCancelRun: () => void cancelRun(),
            isCancellingRun,
            onRetry: retryMessage,
            isMirrorOpen: isMirrorVisible,
            onToggleMirror: openMirror,
            onUpdateMessageContent: (messageId, content) =>
              displayActions.updateMessageContent(messageId, content, chatMessages),
            onProposePrompt: suggestPrompt,
            models: visibleModels,
            selectedModelId,
            setSelectedModelId,
            workspaceReady: Boolean(localStoragePath),
            onPrepareWorkspace: () => void selectWorkspaceFolder(),
            triggerToast: notify,
          }}
          mirrorProps={isMirrorVisible && presentation ? {
            sessionId: activeSessionId,
            presentation,
            selectedSlideId,
            onSelectSlide: setSelectedSlideId,
            logoUrl,
            onCloseMirror: closeMirror,
            highlightSlideId,
            isExpanded: isMirrorExpanded,
            onToggleExpand: toggleMirrorExpanded,
            triggerToast: notify,
          } : undefined}
          deckPreviewProps={{
            open: isDeckPreviewOpen && Boolean(presentation),
            presentation: presentation ?? {
              id: "",
              title: "",
              revision: 0,
              designSystem: DEFAULT_DESIGN_SYSTEM,
              slides: [],
            },
            selectedSlideId,
            logoUrl,
            onSelectSlide: setSelectedSlideId,
            onClose: closeDeckPreview,
          }}
          isDraftChat={isDraftChat}
          isMirrorVisible={isMirrorVisible}
          isMirrorExpanded={isMirrorExpanded}
          isPrimarySidebarCollapsed={workbenchLayout.isPrimarySidebarCollapsed}
          onTogglePrimarySidebar={workbenchLayout.togglePrimarySidebar}
          onStartPanelResize={workbenchLayout.startPanelResize}
        />
      ) : activeMode === "files" ? (
        <ProjectFilesView
          leftPanelProps={leftPanelProps}
          projectFilesProps={{
            sessionId: activeSessionId || undefined,
            sessionTitle: activeSessionTitle,
            workspaceLabel: getWorkspaceLabel(localStoragePath || undefined),
            busy,
            notify,
            onDirtyChange: setProjectFilesDirty,
          }}
          isPrimarySidebarCollapsed={workbenchLayout.isPrimarySidebarCollapsed}
          onTogglePrimarySidebar={workbenchLayout.togglePrimarySidebar}
          onStartPanelResize={workbenchLayout.startPanelResize}
        />
      ) : (
        <SettingsView
          activeCategory={settingsCategory}
          onSelectCategory={setSettingsCategory}
          onBackToWorkspace={() => setActiveMode("workspace")}
          controller={settings}
          localStoragePath={localStoragePath}
          onOpenWorkspace={() => void openWorkspace()}
          notify={notify}
          onStartPanelResize={workbenchLayout.startPanelResize}
        />
      )}
    </AppShell>
  );
}
