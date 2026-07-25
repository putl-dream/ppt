import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { DisplayEvent } from "@shared/card-display-protocol";
import type { AgentQuestionResolved } from "@shared/agent-question";
import {
  buildLayoutPhasePrompt,
  type LayoutChoice,
} from "@shared/layout-preference";
import { getSelectedDesignDirection } from "@shared/design-plan";
import { formatTerminalAgentRunContent } from "@shared/agent-result-copy";
import { mergeResponseText } from "@shared/agent-activity";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import { useProjectStore } from "../../components/project-store";
import {
  ingestDisplayEvent,
  setDisplayCardStatus,
} from "../../cards/display-card-managers";
import type { ChatMessage } from "../chatMessageRuntime";
import type { SettingsController } from "../useSettingsController";
import type { PresentationController } from "../presentation/usePresentationController";
import type { AgentActivityStreamController } from "../agent/useAgentActivityStream";
import type { AgentRunController } from "../agent/useAgentRunController";

type QuestionEvent = Extract<DisplayEvent, { kind: "interaction.question-requested" }>;
type LayoutEvent = Extract<DisplayEvent, { kind: "interaction.layout-required" }>;
type CommandProposalEvent = Extract<DisplayEvent, { kind: "review.command-proposal" }>;
type PatchEvent = Extract<DisplayEvent, { kind: "review.patch-ready" }>;
type ArtifactEvent = Extract<DisplayEvent, { kind: "artifact.ready" }>;

interface UseDisplayEventActionsOptions {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  activeSessionId: string;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  syncPresentation: PresentationController["syncPresentation"];
  setSelectedDesignSystem: SettingsController["setSelectedDesignSystem"];
  activity: AgentActivityStreamController;
  agentRun: Pick<AgentRunController, "startAgent" | "applyAgentResult">;
  notify: (message: string) => void;
}

export interface DisplayEventActions {
  resolveApproval: (event: CommandProposalEvent, approved: boolean) => Promise<void>;
  updateMessageContent: (
    messageId: string,
    newContent: string,
    messages: ChatMessage[],
  ) => void;
  resolveQuestion: (event: QuestionEvent, resolved: AgentQuestionResolved) => void;
  confirmBrief: (event: ArtifactEvent) => Promise<void>;
  confirmOutline: (event: ArtifactEvent) => Promise<void>;
  reviseOutline: (event: ArtifactEvent) => void;
  confirmLayout: (
    event: LayoutEvent,
    choice: LayoutChoice,
  ) => void;
  resolvePatch: (event: PatchEvent, accepted: boolean) => Promise<void>;
}

export function useDisplayEventActions({
  busy,
  setBusy,
  activeSessionId,
  setChatMessages,
  syncPresentation,
  setSelectedDesignSystem,
  activity,
  agentRun,
  notify,
}: UseDisplayEventActionsOptions): DisplayEventActions {
  const hydrateProjectArtifacts = useProjectStore((state) => state.hydrateProjectArtifacts);
  const {
    activeRunTraceRef,
    syncActivityTrace,
  } = activity;
  const { startAgent, applyAgentResult } = agentRun;

  const resolveApproval = useCallback(async (
    event: CommandProposalEvent,
    approved: boolean,
  ) => {
    if (busy || !activeSessionId) return;
    const approvalRequest = event.payload;
    const messageId = event.scope.anchorMessageId;
    setBusy(true);
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

    try {
      const result = await window.desktopApi.resumeAgentRun(
        activeSessionId,
        approvalRequest.threadId,
        approved,
      );
      for (const displayEvent of result.displayEvents ?? []) {
        ingestDisplayEvent({
          ...displayEvent,
          scope: {
            ...displayEvent.scope,
            ...(messageId ? { anchorMessageId: messageId } : {}),
          },
        });
      }

      if (result.status === "completed" || result.status === "rejected") {
        await syncPresentation({
          selectLastSlide: approved,
          openMirror: approved,
          highlightSlide: approved,
        });
        await hydrateProjectArtifacts(activeSessionId);
        if (messageId) {
          setChatMessages((current) => current.map((message) =>
            {
              const projected = message.id === messageId
                ? mergeResponseText(
                    message.activityTrace ?? [],
                    message.content,
                    formatTerminalAgentRunContent(result),
                  )
                : undefined;
              return projected
                ? {
                    ...message,
                    content: projected.content,
                    activityTrace: projected.trace,
                    runStatus: "completed",
                    runError: undefined,
                  }
                : message;
            }
          ));
        }
        notify(approved ? "✅ 变更已应用" : "❌ 变更已取消");
      } else {
        await applyAgentResult(
          result,
          activeRunTraceRef.current,
          event.scope.runId,
          messageId,
        );
      }
    } catch (error) {
      setDisplayCardStatus(event.eventId, "active");
      notify(formatPublicErrorMessage(error, "确认变更失败，请重试。"));
    } finally {
      setBusy(false);
      syncActivityTrace([]);
    }
  }, [
    activeRunTraceRef,
    activeSessionId,
    applyAgentResult,
    busy,
    hydrateProjectArtifacts,
    notify,
    setBusy,
    setChatMessages,
    syncActivityTrace,
    syncPresentation,
  ]);

  const updateMessageContent = useCallback((
    messageId: string,
    newContent: string,
    messages: ChatMessage[],
  ) => {
    const targetMessage = messages.find((message) => message.id === messageId);
    if (targetMessage?.role !== "user") return;

    void startAgent(newContent, messageId);
    notify("✏️ 已更新指令并重新生成");
  }, [notify, startAgent]);

  const resolveQuestion = useCallback((
    event: QuestionEvent,
    resolved: AgentQuestionResolved,
  ) => {
    const messageId = event.scope.anchorMessageId;
    if (messageId) {
      setChatMessages((current) => current.map((message) =>
        message.id === messageId
          ? { ...message, runStatus: "completed", runError: undefined }
          : message
      ));
    }
    void startAgent(resolved.value, undefined, {
      userDisplayContent: resolved.label ?? resolved.value,
      generationMode: "agent",
    });
  }, [setChatMessages, startAgent]);

  const confirmBrief = useCallback(async (_event: ArtifactEvent) => {
    try {
      await useProjectStore.getState().markStageReady("brief");
      notify("✅ Brief 已确认");
    } catch (error) {
      notify(`❌ Brief 确认失败: ${formatPublicErrorMessage(error)}`);
    }
  }, [notify]);

  const confirmOutline = useCallback(async (_event: ArtifactEvent) => {
    try {
      await useProjectStore.getState().markStageReady("outline");
      notify("✅ 大纲已确认");
    } catch (error) {
      notify(`❌ 大纲确认失败: ${formatPublicErrorMessage(error)}`);
    }
  }, [notify]);

  const reviseOutline = useCallback((_event: ArtifactEvent) => {
    void startAgent("请根据当前反馈继续修改大纲结构", undefined, {
      generationMode: "agent",
    });
  }, [startAgent]);

  const confirmLayout = useCallback((
    _event: LayoutEvent,
    choice: LayoutChoice,
  ) => {
    const selected = getSelectedDesignDirection(choice);
    setSelectedDesignSystem(selected.designSystem);
    notify(`🎨 已确认设计方向：${selected.label}`);
    void startAgent(buildLayoutPhasePrompt(choice), undefined, {
      userDisplayContent: false,
      layoutChoice: choice,
      sidechain: true,
      generationMode: "agent",
    });
  }, [notify, setSelectedDesignSystem, startAgent]);

  const resolvePatch = useCallback(async (event: PatchEvent, accepted: boolean) => {
    if (!accepted || !activeSessionId || event.payload.contentAfter === undefined) {
      notify(accepted ? "补丁已确认" : "补丁已拒绝");
      return;
    }
    try {
      await window.desktopApi.writeProjectArtifact(
        activeSessionId,
        event.payload.targetPath,
        event.payload.contentAfter,
      );
      await hydrateProjectArtifacts(activeSessionId);
      notify("补丁已应用");
    } catch (error) {
      setDisplayCardStatus(event.eventId, "active");
      notify(formatPublicErrorMessage(error, "应用补丁失败，请重试。"));
    }
  }, [activeSessionId, hydrateProjectArtifacts, notify]);

  return {
    resolveApproval,
    updateMessageContent,
    resolveQuestion,
    confirmBrief,
    confirmOutline,
    reviseOutline,
    confirmLayout,
    resolvePatch,
  };
}
