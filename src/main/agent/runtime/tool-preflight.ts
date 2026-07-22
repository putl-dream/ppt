import type { AgentModelToolResultBlock, AgentModelToolUseBlock } from "../gateway/types";
import type { ToolContext, ToolDefinition } from "../tools/tool-definition";
import type { ToolInputRepair } from "../tools/tool-input";
import { parseDefinedToolInput } from "../tools/tool-input";
import type { ToolRegistry } from "../tools/tool-registry";
import { triggerHooks } from "./hook-registry";
import type { ToolApprovalHandler } from "./permission-check";
import { rethrowIfRuntimeCancellation } from "./runtime-cancellation";
import { shouldRunBackground } from "./background-task-manager";
import type { ToolExecutionOutcome } from "./tool-execution-engine";

export type ToolPreflightFailureKind =
  | "parse_error"
  | "unavailable"
  | "validation_error"
  | "policy_blocked"
  | "pre_hook_failed";

export interface PreparedToolCall {
  tool: ToolDefinition<any, any>;
  args: any;
  mode: "foreground" | "background";
  repairs: ToolInputRepair[];
}

export type ToolPreflightOutcome =
  | {
      type: "ready";
      prepared: PreparedToolCall;
      repairs: ToolInputRepair[];
    }
  | {
      type: "immediate_result";
      kind: ToolPreflightFailureKind;
      outcome: ToolExecutionOutcome;
      tool?: ToolDefinition<any, any>;
      repairs: ToolInputRepair[];
      validationError?: string;
    }
  | {
      type: "denied";
      tool: ToolDefinition<any, any>;
      modelResult: AgentModelToolResultBlock;
      reason: string;
      repairs: ToolInputRepair[];
    }
  | {
      type: "hook_stopped";
      reason: string;
      repairs: ToolInputRepair[];
    };

export class ToolPreflight {
  constructor(private readonly registry: ToolRegistry) {}

  async prepare(input: {
    toolCall: AgentModelToolUseBlock;
    context: ToolContext;
    workspaceRoot?: string;
    threadId: string;
    requestToolApproval?: ToolApprovalHandler;
    signal?: AbortSignal;
    policyGuidance(toolName: string): Promise<string | undefined>;
  }): Promise<ToolPreflightOutcome> {
    const { toolCall } = input;
    if (toolCall.parseError) {
      return immediate(toolCall, "parse_error", toolCall.parseError);
    }

    const tool = this.registry.get(toolCall.name);
    if (!tool || tool.category !== "core" || tool.loadPolicy !== "core") {
      return immediate(
        toolCall,
        "unavailable",
        "Only registered Core Tools can be called directly.",
      );
    }

    const args = parseDefinedToolInput(tool, toolCall.input);
    if (!args.success) {
      const correction = [
        `Tool ${tool.name} input validation failed. Correct the arguments and retry the tool call.`,
        "Pass nested objects and arrays directly; do not JSON.stringify them.",
        args.error.message,
      ].join("\n");
      return {
        ...immediate(toolCall, "validation_error", correction, tool, args.repairs),
        validationError: args.error.message,
      };
    }

    const policyGuidance = await input.policyGuidance(tool.name);
    if (policyGuidance) {
      return immediate(toolCall, "policy_blocked", policyGuidance, tool, args.repairs);
    }

    let stop;
    try {
      stop = await triggerHooks("PreToolUse", {
        event: "PreToolUse",
        toolName: tool.name,
        args: args.data,
        scope: "main",
        workspaceRoot: input.workspaceRoot,
        threadId: input.threadId,
        requestToolApproval: input.requestToolApproval,
      });
    } catch (error) {
      rethrowIfRuntimeCancellation(error, input.signal, input.context.signal);
      const message = error instanceof Error ? error.message : String(error);
      return immediate(
        toolCall,
        "pre_hook_failed",
        `PreToolUse failed before ${tool.name} executed: ${message}`,
        tool,
        args.repairs,
      );
    }

    if (stop?.toolDenied) {
      const reason = stop.reason || "Tool call denied.";
      return {
        type: "denied",
        tool,
        reason,
        repairs: args.repairs,
        modelResult: notStartedResult(toolCall.id, reason),
      };
    }
    if (stop) return { type: "hook_stopped", reason: stop.reason, repairs: args.repairs };

    return {
      type: "ready",
      repairs: args.repairs,
      prepared: {
        tool,
        args: args.data,
        mode: shouldRunBackground(tool.name, args.data as Record<string, unknown>)
          ? "background"
          : "foreground",
        repairs: args.repairs,
      },
    };
  }
}

function immediate(
  toolCall: AgentModelToolUseBlock,
  kind: ToolPreflightFailureKind,
  message: string,
  tool?: ToolDefinition<any, any>,
  repairs: ToolInputRepair[] = [],
): Extract<ToolPreflightOutcome, { type: "immediate_result" }> {
  return {
    type: "immediate_result",
    kind,
    tool,
    repairs,
    outcome: {
      executionStatus: "not_started",
      sideEffects: "none",
      deliveryStatus: "delivered",
      modelResult: notStartedResult(toolCall.id, message),
      error: message,
      warnings: [],
    },
  };
}

function notStartedResult(toolUseId: string, message: string): AgentModelToolResultBlock {
  return {
    type: "tool_result",
    toolUseId,
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
