import { findRecoverableConversation } from "@shared/session-recovery";
import type { SessionChatMessage } from "@shared/session";
import type { PersistedDisplayCard } from "@shared/card-display-protocol";
import { compactActivityTraceForPersistence } from "@shared/agent-activity";

export type ChatMessage = SessionChatMessage;

export function findActiveThreadId(
  messages: ChatMessage[],
  displayCards: PersistedDisplayCard[] = [],
): string | undefined {
  return findRecoverableConversation(messages, displayCards)?.threadId;
}

export function toSessionChatMessages(messages: ChatMessage[]): SessionChatMessage[] {
  return messages.map(({
    id,
    role,
    content,
    activityTrace,
    runId,
    runStatus,
    runError,
    threadId,
  }) => ({
    id,
    role,
    content,
    activityTrace: compactActivityTraceForPersistence(activityTrace),
    runId,
    runStatus,
    runError,
    threadId,
  }));
}
