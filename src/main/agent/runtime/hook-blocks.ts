import type { AgentRuntimeResult } from "./runtime-types";
import type { ToolApprovalHandler } from "./permission-check";

export interface UserPromptSubmitBlock {
  event: "UserPromptSubmit";
  threadId: string;
  request: string;
  messageHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface PostToolUseBlock {
  event: "PostToolUse";
  toolName: string;
  args: unknown;
  scope: "main" | "subagent";
  result?: unknown;
  error?: string;
  threadId?: string;
}

export interface StopBlock {
  event: "Stop";
  threadId?: string;
  scope: "main" | "subagent";
  result: AgentRuntimeResult | string;
  reason: "completed" | "step_limit" | "aborted";
}

export type RuntimeHookContext = {
  threadId?: string;
  requestToolApproval?: ToolApprovalHandler;
  workspaceRoot?: string;
};
