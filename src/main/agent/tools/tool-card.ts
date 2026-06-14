import type { ToolDefinition } from "./tool-definition";

/**
 * Deferred Tool 的可发现摘要结构，提供给模型做发现决策。
 * 不包含 execute 执行函数或内部权限上下文，避免泄露。
 */
export interface ToolCard {
  name: string;
  description: string;
  disabledScenarios: string[];
  risk: "low" | "medium" | "high";
  parameterSummary: Record<string, { type: string; description: string; required: boolean }>;
  examples: string[];
  approvalRequired: boolean;
}

/**
 * 将完整的工具定义收缩转换为模型可见的 ToolCard
 */
export function toToolCard(definition: ToolDefinition<any, any>): ToolCard {
  const paramSummary: Record<string, { type: string; description: string; required: boolean }> = {};
  
  // 从 inputSchema 中提取字段描述
  if (definition.inputSchema && definition.inputSchema.shape) {
    const shape = definition.inputSchema.shape;
    for (const key of Object.keys(shape)) {
      const field = shape[key];
      const isOptional = field.isOptional();
      paramSummary[key] = {
        type: field._def?.typeName || "unknown",
        description: field.description || "",
        required: !isOptional,
      };
    }
  }

  // 延迟工具默认在 high/medium 风险时需要审批
  const approvalRequired = definition.risk === "high" || definition.risk === "medium";

  return {
    name: definition.name,
    description: definition.description,
    disabledScenarios: [], // 可由特定工具定义或加载策略注入
    risk: definition.risk,
    parameterSummary: paramSummary,
    examples: [],
    approvalRequired,
  };
}
