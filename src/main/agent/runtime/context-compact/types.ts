import type { ModelPromptPayload } from "../turns/model-call-recovery";

export type TranscriptEntry = Record<string, unknown>;

export type ConversationMessage = { role: "user" | "assistant"; content: string };

export interface ContextCompactResult {
  payload: ModelPromptPayload;
  notes: string[];
  compactHistoryFailures: number;
  contextChanged: boolean;
}

export interface PrepareContextOptions {
  payload: ModelPromptPayload;
  systemPrompt: string;
  workspaceRoot?: string;
  threadId?: string;
  tokenThreshold?: number;
  softTokenThreshold?: number;
  compactHistoryFailures?: number;
  gateway?: import("../../gateway/types").AgentModelGateway;
  model?: import("@shared/agent").AgentModelSelection;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
