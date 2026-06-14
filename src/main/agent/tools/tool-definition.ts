/**
 * 所有 Agent 工具的统一元数据与执行契约。
 *
 * 规划定义 loadPolicy、risk、tags、使用时机、输入 schema、prompt 和 execute 上下文。
 * 工具必须显式声明能力边界；未声明的工具默认只能进入 deferred 层。
 */

/**
 * 单个 Agent Runtime 会话中的延迟工具发现状态。
 *
 * SearchExtraTools 只能向集合中追加实际返回给模型的 Deferred Tool 名称。
 * ExecuteExtraTool 只能执行集合中已有的名称。该状态按 thread 隔离，不能跨会话复用。
 */
export type ToolDiscoverySession = {
  discoveredToolNames: Set<string>;
};
