/**
 * Agent Runtime 的稳定协议类型边界。
 */

import type { PresentationCommand } from "@shared/commands";
import type { AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { Presentation } from "@shared/presentation";
import type { ToolApprovalHandler } from "./permission-check";

export type AgentRuntimeRisk = "low" | "medium" | "high";

export interface AgentEnvelope<TType extends string, TData> {
  type: TType;
  data: TData;
}

export type AgentRuntimeResult =
  | AgentEnvelope<"assistant.message", { content: string }>
  | AgentEnvelope<"assistant.ask_user", { content: string; missingFields?: string[] }>
  | AgentEnvelope<
      "deck.command_proposal",
      {
        summary: string;
        commands: PresentationCommand[];
        risk: AgentRuntimeRisk;
        assumptions?: string[];
      }
    >;

export type AgentProtocolEnvelope =
  | AgentRuntimeResult
  | AgentEnvelope<"tool.call", { toolName: string; args: unknown }>;

export interface AgentRuntimeOptions {
  threadId: string;
  request: string;
  presentationSnapshot: Presentation;
  currentSlideId?: string;
  selectedElementIds: string[];
  model?: AgentModelSelection;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  requiredOutcome?: "any" | "command_proposal";
  workspaceRoot?: string;
  /** Owner label for TaskGraphClaim / shutdown unassign. Defaults to "agent". */
  taskGraphOwner?: string;
  maxSteps?: number;
  agentStepLimits?: AgentStepLimits;
  onStreamChunk?: (chunk: string, source: "message" | "tool-summary") => void;
  onThinkingChunk?: (chunk: string, modelStep: number) => void;
  signal?: AbortSignal;
  onProgress?: (event: { type: string; message: string; [key: string]: unknown }) => void;
  requestToolApproval?: ToolApprovalHandler;
  /** Test/harness override; accepts merged or legacy stage names. */
  stageHint?: string;
}
