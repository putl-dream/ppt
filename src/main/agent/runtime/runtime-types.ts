/**
 * Agent Runtime 的稳定协议类型边界。
 *
 * 规划承载 Runtime 输入、三种最终输出、工具调用响应和步骤限制等共享类型。
 * 类型只描述 Runtime 与 workflow/tools 的契约，不包含执行逻辑或具体供应商结构。
 */

import type { PresentationCommand } from "@shared/commands";
import type { AgentModelSelection } from "@shared/agent";
import type { DeckAgentContext } from "@shared/deck-agent-context";
import type { Presentation } from "@shared/presentation";

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
    }
  | {
      type: "artifact_patch";
      targetPath: string;
      patch: string;
      summary: string;
      risk?: AgentRuntimeRisk;
    };

/**
 * Agent Runtime 启动选项输入契约
 */
export interface AgentRuntimeOptions {
  threadId: string;
  request: string;
  presentationSnapshot: Presentation;
  currentSlideId?: string;
  selectedElementIds: string[];
  model?: AgentModelSelection;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /**
   * ask_user 后的继续回合必须解决原行动请求：信息仍不足时再次 ask_user，
   * 否则必须通过 SubmitCommands 形成 command_proposal，不能用叙述性 message 提前结束。
   */
  requiredOutcome?: "any" | "command_proposal";
  deckAgentContext?: DeckAgentContext;
  maxSteps?: number;
  /**
   * 流式回调：当模型生成内容时逐chunk调用（可选）
   * 只在返回message类型结果时生效，工具调用过程不会触发
   */
  onStreamChunk?: (chunk: string) => void;
  /** 模型思考流式回调（extended thinking / reasoning） */
  onThinkingChunk?: (chunk: string) => void;
  signal?: AbortSignal;
  onProgress?: (event: { type: string; message: string; [key: string]: any }) => void;
}
