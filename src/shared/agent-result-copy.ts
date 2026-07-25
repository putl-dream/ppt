import type { AgentRunResult } from "./ipc";
import { formatLeanRunMetrics } from "./lean-mode-contract";
import {
  countSlidesNeedingLayout,
  presentationNeedsLayoutChoice,
} from "./presentation-draft";

export type TerminalAgentRunResult = Extract<
  AgentRunResult,
  { status: "completed" | "rejected" }
>;

/**
 * Main and Renderer must project the same durable terminal copy. Keeping this
 * in Shared prevents a late Renderer snapshot from changing result semantics.
 */
export function formatTerminalAgentRunContent(result: TerminalAgentRunResult): string {
  const base = result.status === "rejected"
    ? "已放弃排版变更提案。"
    : presentationNeedsLayoutChoice(result.presentation)
      ? `内容草稿已就绪（${countSlidesNeedingLayout(result.presentation)} 页待设计），请选择设计方向后继续。`
      : "已成功应用演示文稿更新。";

  return result.leanMetrics
    ? `${base}\n\n${formatLeanRunMetrics(result.leanMetrics)}`
    : base;
}

export function mergeApprovalTerminalContent(
  result: TerminalAgentRunResult,
  waitingContent: string,
): string {
  const terminalContent = formatTerminalAgentRunContent(result);
  return waitingContent.startsWith("已生成 Lean 商业 PPT 草稿")
    ? `${terminalContent}\n\n${waitingContent}`
    : terminalContent;
}

export function mergeWaitingUserRunContent(
  streamedContent: string,
  questionMessage: string,
): string {
  if (!streamedContent) return questionMessage;
  if (!questionMessage || streamedContent.includes(questionMessage)) return streamedContent;
  const separator = streamedContent.endsWith("\n\n")
    ? ""
    : streamedContent.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${streamedContent}${separator}${questionMessage}`;
}
