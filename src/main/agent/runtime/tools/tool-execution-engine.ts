import type { AgentModelToolResultBlock, AgentModelToolUseBlock } from "../../gateway/types";
import type { ToolContext, ToolDefinition } from "../../tools/tool-definition";
import { validateToolOutput } from "../../tools/tool-validation";
import type { PostToolUseBlock } from "../hooks/hook-blocks";
import { prepareToolResultData } from "./tool-result-data";
import { rethrowIfRuntimeCancellation } from "../lifecycle/runtime-cancellation";

export interface ToolExecutionOutcome {
  executionStatus: "not_started" | "threw" | "returned";
  sideEffects: "none" | "uncertain" | "committed_or_unknown";
  deliveryStatus: "delivered" | "validation_failed" | "postprocessing_failed";
  modelResult: AgentModelToolResultBlock;
  validatedResult?: unknown;
  preparedResult?: Awaited<ReturnType<typeof prepareToolResultData>>;
  error?: string;
  warnings: string[];
}

export interface ToolExecutionEngineInput {
  tool: ToolDefinition<any, any>;
  args: unknown;
  context: ToolContext;
  toolCall: AgentModelToolUseBlock;
  runtimeArtifactRoot?: string;
  threadId: string;
  signal?: AbortSignal;
  runPostToolUseHook(block: PostToolUseBlock): Promise<string[]>;
}

export class ToolExecutionEngine {
  async execute(input: ToolExecutionEngineInput): Promise<ToolExecutionOutcome> {
    const { tool, args, context, toolCall } = input;
    let rawResult: unknown;
    try {
      rawResult = await tool.execute(args, context);
    } catch (error) {
      rethrowIfRuntimeCancellation(error, input.signal, context.signal);
      const message = error instanceof Error ? error.message : String(error);
      const warnings = await input.runPostToolUseHook({
        event: "PostToolUse",
        toolName: tool.name,
        args,
        scope: "main",
        executionStatus: "threw",
        sideEffects: "uncertain",
        error: message,
        threadId: input.threadId,
      });
      const guidance = `${message}\nThe tool threw after execution started; side effects may be uncertain. Inspect durable artifacts before retrying.`;
      return {
        executionStatus: "threw",
        sideEffects: "uncertain",
        deliveryStatus: "delivered",
        modelResult: toModelResult(toolCall.id, guidance, true),
        error: guidance,
        warnings,
      };
    }

    let validatedResult: unknown;
    try {
      validatedResult = validateToolOutput(tool, rawResult);
    } catch (error) {
      rethrowIfRuntimeCancellation(error, input.signal, context.signal);
      const message = error instanceof Error ? error.message : String(error);
      const warnings = await input.runPostToolUseHook({
        event: "PostToolUse",
        toolName: tool.name,
        args,
        scope: "main",
        executionStatus: "returned",
        sideEffects: "committed_or_unknown",
        error: message,
        threadId: input.threadId,
      });
      const guidance = `${message}\nThe tool returned after execution; side effects may already exist. Do not retry blindly.`;
      return {
        executionStatus: "returned",
        sideEffects: "committed_or_unknown",
        deliveryStatus: "validation_failed",
        modelResult: toModelResult(toolCall.id, guidance, true),
        error: guidance,
        warnings,
      };
    }

    const warnings = await input.runPostToolUseHook({
      event: "PostToolUse",
      toolName: tool.name,
      args,
      scope: "main",
      executionStatus: "returned",
      sideEffects: "committed_or_unknown",
      result: validatedResult,
      threadId: input.threadId,
    });

    try {
      const modelContent = tool.mapResultToModelContent
        ? await tool.mapResultToModelContent(validatedResult, context)
        : undefined;
      const preparedResult = await prepareToolResultData({
        data: validatedResult,
        modelContent,
        workspaceRoot: input.runtimeArtifactRoot,
        threadId: input.threadId,
        toolUseId: toolCall.id,
        toolName: tool.name,
      });
      return {
        executionStatus: "returned",
        sideEffects: "committed_or_unknown",
        deliveryStatus: "delivered",
        modelResult: toModelResult(toolCall.id, preparedResult.modelContent, false),
        validatedResult,
        preparedResult,
        warnings,
      };
    } catch (error) {
      rethrowIfRuntimeCancellation(error, input.signal, context.signal);
      const message = error instanceof Error ? error.message : String(error);
      const guidance = `Tool ${tool.name} executed successfully, but result post-processing failed: ${message}. Do not retry blindly; inspect durable artifacts first.`;
      return {
        executionStatus: "returned",
        sideEffects: "committed_or_unknown",
        deliveryStatus: "postprocessing_failed",
        modelResult: toModelResult(toolCall.id, guidance, false),
        validatedResult,
        error: message,
        warnings,
      };
    }
  }
}

function toModelResult(
  toolUseId: string,
  text: string,
  isError: boolean,
): AgentModelToolResultBlock {
  return {
    type: "tool_result",
    toolUseId,
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}
