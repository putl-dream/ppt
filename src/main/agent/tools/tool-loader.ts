import type { ToolDefinition } from "./tool-definition";

/**
 * 工具加载策略判定器。
 * 负责根据 loadPolicy 规则对注册工具进行分类，生成首轮携带的工具集，或过滤发现工具。
 */
export class ToolLoader {
  /**
   * 根据加载策略过滤出核心工具集（Core Tools）
   * 核心工具在模型请求时默认被携带
   */
  static loadCoreTools(tools: ToolDefinition<any, any>[]): ToolDefinition<any, any>[] {
    return tools.filter((tool) => tool.loadPolicy === "core" && tool.category === "core");
  }

  /**
   * 过滤出延迟加载工具集（Deferred Tools）
   * 延迟工具模型无法初始见到，需要 SearchExtraTools 发现后通过 ExecuteExtraTool 执行
   */
  static loadDeferredTools(tools: ToolDefinition<any, any>[]): ToolDefinition<any, any>[] {
    return tools.filter((tool) => tool.loadPolicy === "deferred" && tool.category === "deferred");
  }

  /**
   * 获取运行时系统内部工具（Runtime Tools）
   * 这些工具绝不对模型公开，只能在系统级别或 Gate/workflow 内部使用
   */
  static loadRuntimeTools(tools: ToolDefinition<any, any>[]): ToolDefinition<any, any>[] {
    return tools.filter((tool) => tool.loadPolicy === "runtime" || tool.category === "runtime");
  }

  /**
   * 判定某个工具在当前执行上下文是否被允许加载
   */
  static isAllowed(tool: ToolDefinition<any, any>, policyOverride?: Map<string, boolean>): boolean {
    if (tool.loadPolicy === "disabled") {
      return false;
    }
    if (policyOverride && policyOverride.has(tool.name)) {
      return policyOverride.get(tool.name) ?? false;
    }
    return true;
  }
}
