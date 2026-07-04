import type { AgentModelSelection, AgentProvider } from "@shared/agent";

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
export type AgentModelThinkingBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

/**
 * 单个多轮对话消息。原生 tool-use 路径用它承载 assistant 的 tool_use 与
 * user 的 tool_result，替代把整段 transcript 塞进 prompt 字符串的旧做法。
 */
export interface AgentModelMessage {
  role: "user" | "assistant";
  /** 纯文本内容；与 toolCalls / toolResults 互补。 */
  content?: string;
  /** assistant 轮发起的工具调用。 */
  toolCalls?: AgentModelToolCall[];
  /** user 轮回传的工具执行结果。 */
  toolResults?: AgentModelToolResult[];
  /**
   * assistant 轮的扩展思考块。回传时须置于其它块之前并保留 signature，
   * 缺失会导致开启 thinking 的多轮 tool-use 请求被拒。
   */
  thinkingBlocks?: AgentModelThinkingBlock[];
}

/** 模型发起的一次工具调用（原生 tool-use）。 */
export interface AgentModelToolCall {
  /** provider 侧的调用 ID，回传 tool_result 时须原样带回。 */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** 一次工具执行结果，回传给模型。 */
export interface AgentModelToolResult {
  /** 对应 AgentModelToolCall.id。 */
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface AgentModelRequest {
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  /** Per-request override; used by output-truncation recovery. */
  maxOutputTokens?: number;
  /**
   * 原生 tool-use 工具清单。提供时 provider 走原生 tool-use 分支；
   * 省略时保持纯文本 JSON 协议（向后兼容）。
   */
  tools?: AgentToolSchema[];
  /**
   * 多轮对话消息。提供时替代 prompt 作为对话主体（原生 tool-use 路径）；
   * 省略时使用 prompt 字符串（文本协议路径）。
   */
  messages?: AgentModelMessage[];
}

export interface AgentModelResponse {
  provider: AgentProvider;
  model: string;
  text: string;
  requestId?: string;
  stopReason?: string;
  /**
   * 原生 tool-use 返回的工具调用列表。存在时 runtime 走 tool-use 分支；
   * 为空/未定义时回退到解析 text 中的 JSON。
   */
  toolCalls?: AgentModelToolCall[];
  /** 扩展思考模式返回的 thinking 块，回传时须原样带回。 */
  thinkingBlocks?: AgentModelThinkingBlock[];
}

/**
 * 流式传输的单个chunk
 */
export interface AgentModelStreamChunk {
  type: "content" | "thinking" | "complete";
  text: string;
  index?: number;
  stopReason?: string;
  /** 原生 tool-use 路径下，complete chunk 携带完整的工具调用列表。 */
  toolCalls?: AgentModelToolCall[];
  /** complete chunk 携带的扩展思考块，回传时须原样带回。 */
  thinkingBlocks?: AgentModelThinkingBlock[];
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
  /**
   * 是否支持原生 tool-use。返回 true 时 runtime 传 tools + messages 并解析
   * 结构化工具调用；未实现或返回 false 时回退到文本 JSON 协议。
   */
  supportsNativeToolUse?(): boolean;

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
