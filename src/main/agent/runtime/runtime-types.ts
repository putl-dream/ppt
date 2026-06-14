/**
 * Agent Runtime 的稳定协议类型边界。
 *
 * 规划承载 Runtime 输入、三种最终输出、工具调用响应和步骤限制等共享类型。
 * 类型只描述 Runtime 与 workflow/tools 的契约，不包含执行逻辑或具体供应商结构。
 */

import type { PresentationCommand } from "@shared/commands";

export type AgentRuntimeRisk = "low" | "medium" | "high";

/**
 * Agent Runtime 每一轮只能以这三种协议之一结束。
 *
 * assumptions 必须记录模型在生成修改方案时采用、但用户没有明确给出的假设。
 * missingFields 必须指出阻止安全执行的具体缺失信息，不能只返回笼统追问。
 */
export type AgentRuntimeResult =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "ask_user";
      message: string;
      missingFields?: string[];
    }
  | {
      type: "command_proposal";
      summary: string;
      commands: PresentationCommand[];
      risk: AgentRuntimeRisk;
      assumptions?: string[];
    };
