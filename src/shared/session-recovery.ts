import type { PersistedDisplayCard } from "./card-display-protocol";
import type { SessionChatMessage } from "./session";

export interface RecoverableConversation {
  threadId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export type AgentConversationMessage = { role: "user" | "assistant"; content: string };

function isIncompleteAgentTurn(message: SessionChatMessage): boolean {
  return (
    message.role === "assistant" &&
    (message.runStatus === "running" ||
      message.runStatus === "interrupted" ||
      message.runStatus === "failed")
  );
}

function isConversationMessage(message: SessionChatMessage): boolean {
  return (
    message.id !== "init" && Boolean(message.content.trim()) && !isIncompleteAgentTurn(message)
  );
}

export function toAgentMessageHistory(
  messages: SessionChatMessage[],
  currentRequest?: string,
): AgentConversationMessage[] {
  const history = messages
    .filter(isConversationMessage)
    .map((message) => ({ role: message.role, content: message.content }));
  const normalizedRequest = currentRequest?.trim();
  const last = history.at(-1);
  if (normalizedRequest && last?.role === "user" && last.content.trim() === normalizedRequest) {
    return history.slice(0, -1);
  }
  return history;
}

export function findRecoverableConversation(
  messages: SessionChatMessage[],
  displayCards: PersistedDisplayCard[] = [],
): RecoverableConversation | undefined {
  if (
    displayCards.some(
      (card) =>
        card.status === "active" &&
        card.event.kind === "review.command-proposal" &&
        card.event.semantics.blocking,
    )
  )
    return undefined;
  let threadIndex = -1;
  let threadId: string | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") continue;
    if (isIncompleteAgentTurn(message)) {
      if (message.runStatus === "failed" && message.threadId) {
        threadIndex = index;
        threadId = message.threadId;
        break;
      }
      continue;
    }
    if (message.threadId) {
      threadIndex = index;
      threadId = message.threadId;
      break;
    }
    if (message.role === "assistant") return undefined;
  }

  if (!threadId) return undefined;

  let startIndex = 0;
  for (let index = threadIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.threadId !== threadId) {
      startIndex = index + 1;
      break;
    }
  }

  return {
    threadId,
    messages: toAgentMessageHistory(messages.slice(startIndex)),
  };
}
