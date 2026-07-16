import type { Dispatch, SetStateAction } from "react";
import {
  type AgentActivityItem,
  markTraceComplete,
} from "@shared/agent-activity";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import type { ChatMessage } from "../chatMessageRuntime";

interface HandleAgentRunFailureOptions {
  error: unknown;
  isSidechain: boolean;
  runMessageId: string | undefined;
  activeTrace: AgentActivityItem[];
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  notify: (message: string) => void;
}

export function handleAgentRunFailure({
  error,
  isSidechain,
  runMessageId,
  activeTrace,
  setChatMessages,
  notify,
}: HandleAgentRunFailureOptions): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const interrupted = /aborted by user|会话已中断|任务已取消/i.test(errorMessage);
  if (interrupted) {
    if (!isSidechain) {
      const interruptedTrace = markTraceComplete(activeTrace, "denied");
      if (runMessageId) {
        setChatMessages((current) => current.map((message) =>
          message.id === runMessageId
            ? {
                ...message,
                content: message.content.trim()
                  ? `${message.content.trim()}\n\n---\n\n*会话已中断*`
                  : "会话已中断。",
                activityTrace: interruptedTrace.length > 0
                  ? interruptedTrace
                  : message.activityTrace,
              }
            : message,
        ));
      } else {
        setChatMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "会话已中断。",
            activityTrace: interruptedTrace.length > 0 ? interruptedTrace : undefined,
          },
        ]);
      }
    }
    notify("会话已中断");
    return;
  }

  console.error("Agent run failed:", errorMessage);
  const failedTrace = markTraceComplete(activeTrace, "failed");
  const content = `本次处理未完成：${formatPublicErrorMessage(
    errorMessage,
    "处理请求时遇到问题，请稍后重试。",
  )}`;
  if (!isSidechain) {
    if (runMessageId) {
      setChatMessages((current) => current.map((message) =>
        message.id === runMessageId
          ? {
              ...message,
              content,
              activityTrace: failedTrace.length > 0
                ? failedTrace
                : message.activityTrace,
            }
          : message,
      ));
    } else {
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          activityTrace: failedTrace.length > 0 ? failedTrace : undefined,
        },
      ]);
    }
    return;
  }
  console.error("Sidechain agent run failed:", errorMessage);
}
