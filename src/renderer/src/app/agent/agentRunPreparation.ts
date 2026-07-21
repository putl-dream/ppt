import type { AgentRunRequest } from "@shared/ipc";
import type { LayoutChoice } from "@shared/layout-preference";
import type { LeanGenerationMode } from "@shared/lean-mode-contract";
import type { ChatMessage } from "../chatMessageRuntime";

interface BuildAgentRunRequestOptions {
  prompt: string;
  sessionId: string;
  generationMode: LeanGenerationMode;
  layoutChoice?: LayoutChoice;
}

export function buildAgentRunRequest({
  prompt,
  sessionId,
  generationMode,
  layoutChoice,
}: BuildAgentRunRequestOptions): AgentRunRequest {
  return {
    prompt,
    sessionId,
    editorContext: { selectedElementIds: [] },
    generationMode,
    ...(layoutChoice ? { layoutChoice } : {}),
  };
}

interface PrepareAgentRunMessagesOptions {
  sourceMessages: ChatMessage[];
  activeRequest: string;
  userDisplayContent: string | null;
  isSidechain: boolean;
  editedMessageId?: string;
  streamPlaceholder: ChatMessage;
  createMessageId: () => string;
}

export interface PreparedAgentRunMessages {
  runMessages: ChatMessage[];
  forkedMessages?: ChatMessage[];
  retainedMessageIds?: Set<string>;
}

/**
 * Builds the visible conversation for a run without mutating React state.
 * The caller owns persistence and display-card pruning for the returned branch.
 */
export function prepareAgentRunMessages({
  sourceMessages,
  activeRequest,
  userDisplayContent,
  isSidechain,
  editedMessageId,
  streamPlaceholder,
  createMessageId,
}: PrepareAgentRunMessagesOptions): PreparedAgentRunMessages {
  if (isSidechain) {
    return { runMessages: [...sourceMessages, streamPlaceholder] };
  }

  if (editedMessageId) {
    const editedIndex = sourceMessages.findIndex((message) => message.id === editedMessageId);
    if (editedIndex === -1) {
      return { runMessages: [...sourceMessages, streamPlaceholder] };
    }

    const forkedMessages = sourceMessages.slice(0, editedIndex + 1);
    forkedMessages[editedIndex] = {
      ...forkedMessages[editedIndex],
      id: createMessageId(),
      content: userDisplayContent ?? activeRequest,
    };

    return {
      forkedMessages,
      retainedMessageIds: new Set(forkedMessages.map((message) => message.id)),
      runMessages: [...forkedMessages, streamPlaceholder],
    };
  }

  if (userDisplayContent !== null) {
    return {
      runMessages: [
        ...sourceMessages,
        { id: createMessageId(), role: "user", content: userDisplayContent },
        streamPlaceholder,
      ],
    };
  }

  return { runMessages: [...sourceMessages, streamPlaceholder] };
}
