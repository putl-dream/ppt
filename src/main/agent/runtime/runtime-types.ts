/**
 * Agent Runtime 的稳定协议类型边界。
 */

import { presentationCommandSchema } from "@shared/commands";
import { agentQuestionSchema } from "@shared/agent-question";
import { z } from "zod";
import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { Presentation } from "@shared/presentation";
import type { LayoutChoice } from "@shared/layout-preference";
import type { ToolApprovalHandler } from "./tools/permission-check";
import type { MessageBus } from "../teammate/message-bus";
import type { TeammateManager } from "../teammate/spawn-teammate";

export type AgentRuntimeRisk = "low" | "medium" | "high";

export const agentMessageResultSchema = z.object({
  type: z.literal("message"),
  content: z.string().trim().min(1),
});

export const agentAskUserResultSchema = z.object({
  type: z.literal("ask_user"),
  content: z.string().trim().min(1),
  missingFields: z.array(z.string()).optional(),
  question: agentQuestionSchema.optional(),
});

export const agentCommandProposalResultSchema = z.object({
  type: z.literal("command_proposal"),
  summary: z.string().trim().min(1),
  commands: z.array(presentationCommandSchema).min(1),
  risk: z.enum(["low", "medium", "high"]),
  assumptions: z.array(z.string()).optional(),
});

export type AgentMessageResult = z.infer<typeof agentMessageResultSchema>;
export type AgentAskUserResult = z.infer<typeof agentAskUserResultSchema>;
export type AgentCommandProposalResult = z.infer<typeof agentCommandProposalResultSchema>;
export type AgentRuntimeResult =
  | AgentMessageResult
  | AgentAskUserResult
  | AgentCommandProposalResult;

export interface AgentRuntimeOptions {
  threadId: string;
  request: string;
  presentationSnapshot: Presentation;
  currentSlideId?: string;
  selectedElementIds: string[];
  model?: AgentModelSelection;
  executionStrategy?: AgentExecutionStrategy;
  runId?: string;
  /** Restore the canonical ContentBlock checkpoint for this thread. */
  resumeThread?: boolean;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  requiredOutcome?: "any" | "command_proposal";
  /** Structured layout selection; runtime schedules design work without prompt-driven delegation. */
  layoutChoice?: LayoutChoice;
  workspaceRoot?: string;
  /** Application-owned runtime directory; never points at the user workspace. */
  runtimeRoot?: string;
  /** Owner label for TaskGraphClaim / shutdown unassign. Defaults to "agent". */
  taskGraphOwner?: string;
  maxSteps?: number;
  agentStepLimits?: AgentStepLimits;
  onStreamChunk?: (chunk: string, source: "message" | "tool-summary") => void;
  onThinkingChunk?: (chunk: string, modelStep: number) => void;
  signal?: AbortSignal;
  onProgress?: (event: { type: string; message: string; [key: string]: unknown }) => void;
  requestToolApproval?: ToolApprovalHandler;
  /** File-backed inbox bus used by lead and teammates. */
  messageBus?: MessageBus;
  /** Long-lived teammate manager exposed through spawn_teammate. */
  teammateManager?: TeammateManager;
  /** Test/harness override; accepts merged or legacy stage names. */
  stageHint?: string;
}
