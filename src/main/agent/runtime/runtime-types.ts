/**
 * Agent Runtime 的稳定协议类型边界。
 */

import type { PresentationCommand } from "@shared/commands";
import type { AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { Presentation } from "@shared/presentation";
import type { ToolApprovalHandler } from "./permission-check";

export type AgentRuntimeRisk = "low" | "medium" | "high";

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
}
