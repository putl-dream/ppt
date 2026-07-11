import type { AgentModelSelection, AgentProvider } from "@shared/agent";
import type { AgentGatewayConfig } from "@shared/agent-gateway-config";
import type { ProviderTokenUsage } from "@shared/token-usage";

export type AgentResponseContract = "markdown-summary" | "none";

/**
 * 原生 tool-use 的工具声明。inputSchema 为标准 JSON Schema（由 zod 转换而来），
 * 直接透传给 provider 的 tools 字段。
 */
export interface AgentToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * 扩展思考模式返回的 thinking 块。开启 thinking 后，若 assistant 轮包含
 * tool_use，Anthropic 要求下一次请求原样回传这些块（含 signature），
 * 否则报错 `content[].thinking ... must be passed back`。
 */
export type AgentModelTextBlock = { type: "text"; text: string };

export type AgentModelThinkingBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

/** Base64 image block used in user messages and tool results. */
export interface AgentModelImageBlock {
  type: "image";
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
}

export interface AgentModelToolUseBlock {
  type: "tool_use";
  /** Provider call ID. A tool_result must reference this exact value. */
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Provider argument JSON could not be parsed; execution must return an error result. */
  parseError?: string;
}

export interface AgentModelToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: Array<AgentModelTextBlock | AgentModelImageBlock>;
  isError?: boolean;
}

/**
 * Provider-neutral model content protocol. It intentionally stays smaller
 * than local messages and tool execution records.
 */
export type AgentModelContentBlock =
  | AgentModelTextBlock
  | AgentModelThinkingBlock
  | AgentModelImageBlock
  | AgentModelToolUseBlock
  | AgentModelToolResultBlock
  | {
      /** MCP, web-search, code-execution, or another provider-managed block. */
      type: "server_tool";
      providerType: string;
      data: unknown;
    };

/**
 * 单个多轮对话消息。原生 tool-use 路径用它承载 assistant 的 tool_use 与
 * user 的 tool_result，替代把整段 transcript 塞进 prompt 字符串的旧做法。
 */
export interface AgentModelMessage {
  role: "user" | "assistant";
  /** The sole message payload; there are no flattened compatibility fields. */
  content: AgentModelContentBlock[];
}

export interface AgentModelRequest {
  prompt: string;
  systemPrompt?: string;
  /**
   * Output contract for the provider request. Runtime prompts may already
   * include the contract text; adapters still apply this as a final guard when
   * a specialized call uses a shorter system prompt.
   */
  responseContract?: AgentResponseContract;
  signal?: AbortSignal;
  /** Per-request override; used by output-truncation recovery. */
  maxOutputTokens?: number;
  /**
   * Native tool-use declarations. Tool calls are always returned as
   * `tool_use` content blocks; text JSON tool calls are not supported.
   */
  tools?: AgentToolSchema[];
  /**
   * Canonical multi-turn ContentBlock messages. When omitted, `prompt` is
   * converted to one user text block for specialized one-shot calls.
   */
  messages?: AgentModelMessage[];
}

export interface AgentModelResponse {
  provider: AgentProvider;
  model: string;
  /** Sole model payload. */
  content: AgentModelContentBlock[];
  requestId?: string;
  stopReason?: string;
  /** Provider-reported usage for this exact API request. */
  usage?: ProviderTokenUsage;
}

/**
 * 流式传输的单个chunk
 */
export type AgentModelStreamChunk =
  | { type: "text_delta"; text: string; index?: number }
  | { type: "thinking_delta"; thinking: string; index?: number }
  | {
      type: "complete";
      content: AgentModelContentBlock[];
      stopReason?: string;
      usage?: ProviderTokenUsage;
    };

/**
 * 流式传输完成后的元数据
 */
export interface AgentModelStreamMetadata {
  provider: AgentProvider;
  model: string;
  requestId?: string;
  stopReason?: string;
  usage?: ProviderTokenUsage;
}

export interface ResolvedAgentModelConfig extends AgentModelSelection {
  apiKey: string;
  baseURL?: string;
  openaiApiMode?: "responses" | "chat-completions";
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface AgentModelGateway {
  /** Optional runtime configuration exposed to tools owned by this application. */
  getGatewayConfig?(): AgentGatewayConfig;

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
