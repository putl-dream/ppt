import type { AgentOutlineRequest } from "./ipc";
import type { SessionChatMessage } from "./session";

export interface RecoverableOutlineConversation {
  outlineRequest: AgentOutlineRequest;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export type AgentConversationMessage = { role: "user" | "assistant"; content: string };

function isGeneratedAgentError(message: SessionChatMessage): boolean {
  return message.role === "assistant" &&
    (/^(?:执行指令|确认大纲)时发生错误：/.test(message.content.trim()));
}

function isConversationMessage(message: SessionChatMessage): boolean {
  return message.id !== "init" &&
    Boolean(message.content.trim()) &&
    !isGeneratedAgentError(message);
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

export function findRecoverableOutlineConversation(
  messages: SessionChatMessage[],
): RecoverableOutlineConversation | undefined {
  let outlineIndex = -1;
  let outlineRequest: AgentOutlineRequest | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" || isGeneratedAgentError(message)) continue;
    if (message.approval) return undefined;
    if (message.outlineRequest) {
      outlineIndex = index;
      outlineRequest = message.outlineRequest;
      break;
    }
    if (message.role === "assistant") return undefined;
  }

  if (!outlineRequest) return undefined;

  let startIndex = 0;
  for (let index = outlineIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.outlineRequest?.threadId !== outlineRequest.threadId) {
      startIndex = index + 1;
      break;
    }
  }

  return {
    outlineRequest,
    messages: toAgentMessageHistory(messages.slice(startIndex)),
  };
}
