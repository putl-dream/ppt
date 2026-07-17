import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { DisplayEvent } from "@shared/card-display-protocol";
import type { AgentQuestionResolved } from "@shared/agent-question";
import {
  buildLayoutPhasePrompt,
  saveLayoutVisualMode,
  type LayoutVisualMode,
} from "@shared/layout-preference";
import type { DesignSystemV1 } from "@design-system";
import { formatLeanRunMetrics } from "@shared/lean-mode-contract";
import {
  countSlidesNeedingLayout,
  presentationNeedsLayoutChoice,
} from "@shared/presentation-draft";
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
    mode: LayoutVisualMode,
    designSystem: DesignSystemV1,
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
    setThoughtProgress,
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

    const progressInterval = window.setInterval(() => {
      setThoughtProgress((progress) => progress >= 95 ? 95 : progress + 25);
    }, 200);

    try {
      const result = await window.desktopApi.resumeAgentRun(
        activeSessionId,
        approvalRequest.threadId,
        approved,
      );
      window.clearInterval(progressInterval);
      setThoughtProgress(100);

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
        const resolvedContentBase = result.status === "rejected"
          ? "已放弃排版变更提案。"
          : presentationNeedsLayoutChoice(result.presentation)
            ? `内容草稿已就绪（${countSlidesNeedingLayout(result.presentation)} 页待排版），请选择排版方式后继续。`
            : "已成功应用变更方案。";
        const isLeanProposal = approvalRequest.summary.startsWith("Lean Mode");
        const resolvedContent = isLeanProposal
          ? `${resolvedContentBase}\n\n${approvalRequest.summary}`
          : result.leanMetrics
            ? `${resolvedContentBase}\n\n${formatLeanRunMetrics(result.leanMetrics)}`
            : resolvedContentBase;
        if (messageId) {
          setChatMessages((current) => current.map((message) =>
            message.id === messageId ? { ...message, content: resolvedContent } : message
          ));
        }
        notify(approved ? "✅ 变更已应用" : "❌ 变更已取消");
      } else {
        await applyAgentResult(result, activeRunTraceRef.current);
      }
    } catch (error) {
      window.clearInterval(progressInterval);
      setDisplayCardStatus(event.eventId, "active");
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `确认变更时发生异常：${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setBusy(false);
      syncActivityTrace([]);
      setThoughtProgress(0);
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
    setThoughtProgress,
    syncActivityTrace,
    syncPresentation,
  ]);

  const updateMessageContent = useCallback((
    messageId: string,
    newContent: string,
    messages: ChatMessage[],
  ) => {
    const targetMessage = messages.find((message) => message.id === messageId);
    if (!targetMessage) return;

    if (targetMessage.role === "user") {
      void startAgent(newContent, messageId);
      notify("✏️ 已更新指令并重新生成");
      return;
    }
    setChatMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, content: newContent } : message
      )
    );
    notify("✏️ 消息内容已更新");
  }, [notify, setChatMessages, startAgent]);

  const resolveQuestion = useCallback((
    _event: QuestionEvent,
    resolved: AgentQuestionResolved,
  ) => {
    void startAgent(resolved.value, undefined, {
      userDisplayContent: resolved.label ?? resolved.value,
      generationMode: "agent",
    });
  }, [startAgent]);

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
    mode: LayoutVisualMode,
    designSystem: DesignSystemV1,
  ) => {
    saveLayoutVisualMode(mode);
    setSelectedDesignSystem(designSystem);
    notify(mode === "creative" ? "🎨 开始创意装饰排版" : "📐 开始标准排版");
    void startAgent(buildLayoutPhasePrompt(mode, designSystem), undefined, {
      userDisplayContent: false,
      layoutChoice: { mode, designSystem },
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
