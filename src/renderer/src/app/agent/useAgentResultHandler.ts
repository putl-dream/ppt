import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AgentRunResult } from "@shared/ipc";
import { formatLeanRunMetrics } from "@shared/lean-mode-contract";
import {
  type AgentActivityItem,
  markTraceComplete,
  mergeActivityTraces,
} from "@shared/agent-activity";
import {
  countSlidesNeedingLayout,
  presentationNeedsLayoutChoice,
} from "@shared/presentation-draft";
import { useProjectStore } from "../../components/project-store";
import { ingestDisplayEvent } from "../../cards/display-card-managers";
import type { ChatMessage } from "../chatMessageRuntime";
import type { PresentationController } from "../presentation/usePresentationController";
import type { AgentActivityStreamController } from "./useAgentActivityStream";

const isRunAbortedMessage = (message: string) =>
  message === "会话已中断。" || message === "任务已取消。";

interface UseAgentResultHandlerOptions {
  activeSessionId: string;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  syncPresentation: PresentationController["syncPresentation"];
  activity: Pick<
    AgentActivityStreamController,
    "activeRunTraceRef" | "sidechainRunRef" | "streamMessageIdsRef"
  >;
  notify: (message: string) => void;
}

export type ApplyAgentResult = (
  result: AgentRunResult,
  trace: AgentActivityItem[],
  runId?: string,
) => Promise<void>;

export function useAgentResultHandler({
  activeSessionId,
  setChatMessages,
  syncPresentation,
  activity,
  notify,
}: UseAgentResultHandlerOptions): ApplyAgentResult {
  const hydrateProjectArtifacts = useProjectStore((state) => state.hydrateProjectArtifacts);
  const {
    activeRunTraceRef,
    sidechainRunRef,
    streamMessageIdsRef,
  } = activity;

  return useCallback(async (
    result: AgentRunResult,
    trace: AgentActivityItem[],
    runId?: string,
  ) => {
    const isSidechainRun = Boolean(runId && sidechainRunRef.current === runId);
    const messageId = runId ? streamMessageIdsRef.current.get(runId) : undefined;
    const hostMessageId = messageId ?? crypto.randomUUID();
    for (const event of result.displayEvents ?? []) {
      try {
        ingestDisplayEvent({
          ...event,
          scope: { ...event.scope, anchorMessageId: hostMessageId },
        });
      } catch (error) {
        console.error("Invalid result display event received:", error);
      }
    }
    const finalizeTrace = (existing?: AgentActivityItem[]) => markTraceComplete(
      mergeActivityTraces(existing, trace, activeRunTraceRef.current) ?? [],
    );
    const resolvedTrace = (existing?: AgentActivityItem[]) => {
      const merged = finalizeTrace(existing);
      return merged.length > 0 ? merged : undefined;
    };

    if (result.status === "chat") {
      if (isSidechainRun && !isRunAbortedMessage(result.message)) {
        if (messageId) {
          setChatMessages((current) => current.map((message) => message.id === messageId
            ? {
                ...message,
                activityTrace: resolvedTrace(message.activityTrace),
                threadId: result.threadId ?? message.threadId,
              }
            : message));
        }
        return;
      }
      const interrupted = isRunAbortedMessage(result.message);
      const resolveInterruptedContent = (existingContent: string) => {
        if (!interrupted) return result.message;
        const trimmed = existingContent.trim();
        return trimmed ? `${trimmed}\n\n---\n\n*会话已中断*` : "会话已中断。";
      };

      if (messageId) {
        setChatMessages((current) => current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: resolveInterruptedContent(message.content),
                activityTrace: resolvedTrace(message.activityTrace),
                threadId: result.threadId,
              }
            : message,
        ));
      } else {
        setChatMessages((current) => [
          ...current,
          {
            id: hostMessageId,
            role: "assistant",
            content: interrupted ? "会话已中断。" : result.message,
            activityTrace: resolvedTrace(),
            threadId: result.threadId,
          },
        ]);
      }
      if (interrupted) notify("会话已中断");
      return;
    }

    if (result.status === "approval-required") {
      const content = result.leanMetrics
        ? `已生成 Lean 商业 PPT 草稿，请在下方审核后应用。\n\n${formatLeanRunMetrics(result.leanMetrics)}`
        : isSidechainRun && messageId
          ? "后台任务已提出排版更新方案，请在下方审核后应用。"
          : "已提出排版更新方案，请在下方审核后应用。";
      if (messageId) {
        setChatMessages((current) => current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content,
                activityTrace: resolvedTrace(message.activityTrace),
                threadId: result.approval.threadId,
              }
            : message,
        ));
      } else {
        setChatMessages((current) => [
          ...current,
          {
            id: hostMessageId,
            role: "assistant",
            content,
            activityTrace: resolvedTrace(),
            threadId: result.approval.threadId,
          },
        ]);
      }
      notify(result.leanMetrics
        ? "Lean PPT 草稿已生成，请进行审核"
        : "AI 已提出排版变更方案，请进行审核");
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

    const finalContentBase = result.status === "rejected"
      ? "已放弃排版变更提案。"
      : presentationNeedsLayoutChoice(result.presentation)
        ? `内容草稿已就绪（${countSlidesNeedingLayout(result.presentation)} 页待排版），请选择排版方式后继续。`
        : "已根据确认的大纲生成并应用演示文稿。";
    const finalContent = result.leanMetrics
      ? `${finalContentBase}\n\n${formatLeanRunMetrics(result.leanMetrics)}`
      : finalContentBase;

    if (messageId) {
      setChatMessages((current) => current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: finalContent,
              activityTrace: resolvedTrace(message.activityTrace),
            }
          : message,
      ));
    } else {
      setChatMessages((current) => [
        ...current,
        {
          id: hostMessageId,
          role: "assistant",
          content: finalContent,
          activityTrace: resolvedTrace(),
        },
      ]);
    }
    notify(
      result.status === "rejected"
        ? "变更已取消"
        : result.presentation
            && presentationNeedsLayoutChoice(result.presentation)
            && !isSidechainRun
          ? "内容草稿已就绪，请选择排版方式"
          : result.presentation && presentationNeedsLayoutChoice(result.presentation)
            ? "排版尚未完整应用，请检查任务计划"
            : "演示文稿已成功更新",
    );
  }, [
    activeRunTraceRef,
    activeSessionId,
    hydrateProjectArtifacts,
    notify,
    setChatMessages,
    sidechainRunRef,
    streamMessageIdsRef,
    syncPresentation,
  ]);
}
