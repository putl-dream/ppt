import {
  mergeInlineCardRefs,
  type InlineCardRef,
  type LayoutVisualMode,
} from "@shared/inline-artifact-cards";
import type { Presentation } from "@shared/presentation";
import {
  countSlidesNeedingLayout,
  presentationNeedsLayoutChoice,
} from "@shared/presentation-draft";
import { findRecoverableConversation } from "@shared/session-recovery";
import type { SessionChatMessage } from "@shared/session";
import { compactActivityTraceForPersistence } from "@shared/agent-activity";

export type ChatMessage = SessionChatMessage;

export function findActiveThreadId(messages: ChatMessage[]): string | undefined {
  return findRecoverableConversation(messages)?.threadId;
}

export function toSessionChatMessages(messages: ChatMessage[]): SessionChatMessage[] {
  return messages.map(({
    id,
    role,
    content,
    thought,
    reasoning,
    activityTrace,
    progress,
    approval,
    patch,
    inlineCards,
    question,
    threadId,
  }) => ({
    id,
    role,
    content,
    thought,
    reasoning,
    activityTrace: compactActivityTraceForPersistence(activityTrace),
    progress,
    approval,
    patch,
    inlineCards,
    question,
    threadId,
  }));
}

export function resolveInlineCardInMessages(
  messages: ChatMessage[],
  messageId: string,
  type: InlineCardRef["type"],
  resolved: InlineCardRef["resolved"],
  layoutMode?: LayoutVisualMode,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const inlineCards = (message.inlineCards ?? [{ type }]).map((card) =>
      card.type === type
        ? { ...card, resolved, ...(layoutMode ? { layoutMode } : {}) }
        : card,
    );
    return { ...message, inlineCards };
  });
}

function attachInlineCards(
  message: ChatMessage,
  additions: Array<"brief" | "outline" | "layout" | "deck">,
): ChatMessage {
  return {
    ...message,
    inlineCards: mergeInlineCardRefs(message.inlineCards, additions),
  };
}

function buildLayoutDraftContent(slideCount: number): string {
  return `内容草稿已就绪（${slideCount} 页待排版），请选择排版方式后继续。`;
}

export function finalizeAgentMessage(
  message: ChatMessage,
  presentation: Presentation | undefined,
  fallbackContent: string,
  options: { allowLayoutChoice?: boolean } = {},
): ChatMessage {
  if (presentation && presentationNeedsLayoutChoice(presentation)) {
    if (options.allowLayoutChoice === false) {
      return { ...message, content: fallbackContent };
    }
    const slideCount = countSlidesNeedingLayout(presentation);
    return attachInlineCards(
      { ...message, content: buildLayoutDraftContent(slideCount) },
      ["layout"],
    );
  }

  return attachInlineCards({ ...message, content: fallbackContent }, ["deck"]);
}
