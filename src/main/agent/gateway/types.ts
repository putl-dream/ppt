import type { AgentModelSelection, AgentProvider } from "@shared/agent";

export interface AgentModelRequest {
  prompt: string;
  systemPrompt?: string;
}

export interface AgentModelResponse {
  provider: AgentProvider;
  model: string;
  text: string;
  requestId?: string;
  stopReason?: string;
}

export interface ResolvedAgentModelConfig extends AgentModelSelection {
  apiKey: string;
  baseURL?: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface AgentModelGateway {
  generateText(
    request: AgentModelRequest,
    selection?: AgentModelSelection,
  ): Promise<AgentModelResponse>;
}
