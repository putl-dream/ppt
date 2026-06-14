import { z } from "zod";
import type { Presentation } from "@shared/presentation";
import type { ToolRegistry } from "./tool-registry";

/**
 * 工具加载策略。
 * - core: 首次模型请求可见，低风险，默认加载。
 * - deferred: 默认不可见，需通过 SearchExtraTools 发现后，再由 ExecuteExtraTool 调用。
 * - runtime: 仅系统内部调用，对模型永远不可见。
 * - disabled: 禁用。
 */
export type ToolLoadPolicy = "core" | "deferred" | "runtime" | "disabled";

/**
 * 单个 Agent Runtime 会话中的延迟工具发现状态。
 *
 * SearchExtraTools 只能向集合中追加实际返回给模型的 Deferred Tool 名称。
 * ExecuteExtraTool 只能执行集合中已有的名称。该状态按 thread 隔离，不能跨会话复用。
 */
export interface ToolDiscoverySession {
  discoveredToolNames: Set<string>;
}

/**
 * 工具执行的只读上下文环境，包含当前 PPT 快照、选区和会话历史等。
 */
export interface ToolContext {
  /** 当前 PPT 快照（克隆快照，防模型或工具直接篡改真实状态） */
  readonly presentation: Presentation;
  /** 当前编辑页 ID */
  readonly currentSlideId?: string;
  /** 当前选中的元素 ID 列表 */
  readonly selectedElementIds: string[];
  /** 延迟工具发现会话 */
  readonly discoverySession: ToolDiscoverySession;
  /** 当前 Runtime 使用的工具注册表，只允许通过注册表发现和执行工具 */
  readonly registry: ToolRegistry;
  /** 历史消息上下文 */
  readonly messageHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * 所有 Agent 工具的统一元数据与执行契约。
 */
export interface ToolDefinition<TParams extends z.ZodObject<any> = z.ZodObject<any>, TResult = any> {
  name: string;
  description: string;
  category: "core" | "deferred" | "runtime";
  loadPolicy: ToolLoadPolicy;
  inputSchema: TParams;
  risk: "low" | "medium" | "high";
  execute: (args: z.infer<TParams>, context: ToolContext) => Promise<TResult>;
}
