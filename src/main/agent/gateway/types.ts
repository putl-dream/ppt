import type { AgentModelSelection, AgentProvider } from "@shared/agent";

export interface AgentModelRequest {
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  /** Per-request override; used by output-truncation recovery. */
  maxOutputTokens?: number;
}

export interface AgentModelResponse {
  provider: AgentProvider;
  model: string;
  text: string;
  requestId?: string;
  stopReason?: string;
}

/**
 * 流式传输的单个chunk
 */
export interface AgentModelStreamChunk {
  type: "content" | "thinking" | "complete";
  text: string;
  index?: number;
  stopReason?: string;
}

/**
 * 流式传输完成后的元数据
 */
export interface AgentModelStreamMetadata {
  provider: AgentProvider;
  model: string;
  requestId?: string;
  stopReason?: string;
}

export interface ResolvedAgentModelConfig extends AgentModelSelection {
  apiKey: string;
  baseURL?: string;
  openaiApiMode?: "responses" | "chat-completions";
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface AgentModelGateway {
  generateText(
    request: AgentModelRequest,
    selection?: AgentModelSelection,
  ): Promise<AgentModelResponse>;

  /**
   * 流式生成文本。返回AsyncIterable，调用者可以逐chunk接收生成的内容。
   * 最后一个chunk的type为'complete'，表示生成完成。
   */
  generateTextStream(
    request: AgentModelRequest,
    selection?: AgentModelSelection,
  ): AsyncIterable<AgentModelStreamChunk>;
}
