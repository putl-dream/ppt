import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DESIGN_SYSTEM } from "@design-system";
import type { LeanGenerationMode } from "@shared/lean-mode-contract";
import { getWorkspaceLabel } from "@shared/workspace";
import {
  setDisplayCardStatus,
  useNotificationCardManager,
} from "./cards/display-card-managers";
import { AppShell } from "./app/AppShell";
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
import { useUserQuerySubmission } from "./app/useUserQuerySubmission";

type SettingsCategory =
  | "account"
  | "models"
  | "gateway"
  | "generation"
  | "project"
  | "appearance"
  | "diagnostics";

const GENERATION_MODE_STORAGE_KEY = "ppt-generation-mode";

function loadGenerationMode(): LeanGenerationMode {
  try {
    return window.localStorage.getItem(GENERATION_MODE_STORAGE_KEY) === "lean"
      ? "lean"
      : "agent";
  } catch {
    return "agent";
  }
}

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
  } = presentationController;

  const [activeMode, setActiveMode] = useState<AppMode>("workspace");
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("account");
  const workbenchLayout = useWorkbenchLayout({
    activeMode,
    previewOpen: isMirrorVisible,
    previewExpanded: isMirrorExpanded,
  });
  const settings = useSettingsController(bootstrap, presentation, notify);
  const {
    computedTheme,
    logoUrl,
    selectedModelId,
    selectedDesignSystem,
    setSelectedDesignSystem,
    selectModel: setSelectedModelId,
    visibleModels,
  } = settings;

  const [request, setRequest] = useState("");
  const [generationMode, setGenerationModeState] = useState<LeanGenerationMode>(
    loadGenerationMode,
  );
  const setGenerationMode = useCallback((mode: LeanGenerationMode) => {
    setGenerationModeState(mode);
    try {
      window.localStorage.setItem(GENERATION_MODE_STORAGE_KEY, mode);
    } catch {
      // Storage is an enhancement; the in-memory mode remains authoritative.
    }
  }, []);
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
    thoughtProgress,
    agentActivityMode,
  } = activity;
  const agentRun = useAgentRunController({
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
    generationMode,
    selectedDesignSystem,
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
    setSelectedDesignSystem,
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

  return (
    <AppShell
      dark={computedTheme === "dark"}
      notificationMessage={toastMessage}
      workspaceClassName={workbenchLayout.workspaceClassName}
      workspaceStyle={workbenchLayout.workspaceStyle}
      showSidebarToggle={activeMode === "workspace"}
      sidebarCollapsed={workbenchLayout.isPrimarySidebarCollapsed}
      onToggleSidebar={workbenchLayout.togglePrimarySidebar}
    >
      {activeMode === "workspace" ? (
        <WorkspaceView
          leftPanelProps={{
            sessions,
            activeSessionId,
            onSelectSession: selectSession,
            onNewSession: () => void newSession(),
            onNewSessionInWorkspace: newSessionInWorkspace,
            onToggleSettings: () => {
              setActiveMode("settings");
              setSettingsCategory("account");
            },
            onDeleteSession: deleteSession,
          }}
          chatWorkspaceProps={{
            isNewChat: isDraftChat,
            conversationTitle: activeSessionTitle,
            chatMessages,
            presentation,
            activityTrace,
            thoughtProgress,
            agentActivityMode,
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
            onConfirmBrief: displayActions.confirmBrief,
            onConfirmOutline: displayActions.confirmOutline,
            onConfirmLayout: displayActions.confirmLayout,
            onReviseOutline: displayActions.reviseOutline,
            onOpenDeckPreview: openDeckPreview,
            onExportDeck: () => void exportDeck(),
            isExportingDeck,
            selectedDesignSystem,
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
            generationMode,
            onChangeGenerationMode: setGenerationMode,
            workspaceReady: Boolean(localStoragePath),
            sandboxName: getWorkspaceLabel(localStoragePath || undefined),
            onPrepareWorkspace: () => void selectWorkspaceFolder(),
            triggerToast: notify,
          }}
          mirrorProps={isMirrorVisible && presentation ? {
            presentation,
            selectedSlideId,
            onSelectSlide: setSelectedSlideId,
            themeMode: computedTheme,
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
