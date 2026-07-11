import type {
  AgentModelGateway,
  AgentModelMessage,
  AgentModelToolResultBlock,
} from "../gateway/types";
import type { AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { SubAgentProgressListener } from "@shared/subagent-progress";
import { formatSubAgentToolLabel } from "@shared/subagent-progress";
import {
  buildSubStepLimitMessage,
  getEffectiveSubMaxSteps,
  resolveAgentStepLimits,
} from "@shared/agent-step-limits";
import { textFromContentBlocks, toolUseBlocksFromContent } from "../gateway/content-blocks";
import { ensureToolResultPairing } from "../gateway/message-pairing";
import { ensureDefaultHooks } from "../runtime/default-hooks";
import { triggerHooks } from "../runtime/hook-registry";
import type { PostToolUseBlock, StopBlock } from "../runtime/hook-blocks";
import type { ToolApprovalHandler } from "../runtime/permission-check";
import { buildSubAgentSystemPrompt } from "./sub-system-prompt";
import { callModelWithRecovery } from "../runtime/model-call-recovery";
import { toToolInputSchema } from "../tools/tool-schema";
import { parseToolInput } from "../tools/tool-input";
import {
  SUB_AGENT_TOOL_HANDLERS,
  SUB_AGENT_TOOLS,
  type SubAgentToolContext,
} from "./workspace-tools";

export interface SpawnSubAgentOptions {
  description: string;
  workspaceRoot: string;
  gateway: AgentModelGateway;
  model?: AgentModelSelection;
  maxSteps?: number;
  agentStepLimits?: AgentStepLimits;
  signal?: AbortSignal;
  requestToolApproval?: ToolApprovalHandler;
  taskId?: string;
  onProgress?: SubAgentProgressListener;
}

function emitProgress(options: SpawnSubAgentOptions, event: Parameters<SubAgentProgressListener>[0]): void {
  if (!options.taskId || !options.onProgress) return;
  options.onProgress(event);
}

export async function spawnSubAgent(options: SpawnSubAgentOptions): Promise<string> {
  ensureDefaultHooks();
  const stepLimits = resolveAgentStepLimits(options.agentStepLimits);
  const maxSteps = options.maxSteps ?? getEffectiveSubMaxSteps(stepLimits);
  const systemPrompt = buildSubAgentSystemPrompt(SUB_AGENT_TOOLS);
  const transcript: Array<Record<string, unknown>> = [
    { role: "user", content: options.description },
  ];
  const modelMessages: AgentModelMessage[] = [{
    role: "user",
    content: [{ type: "text", text: options.description }],
  }];
  const tools = SUB_AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: toToolInputSchema(tool.inputSchema),
  }));
  const toolContext: SubAgentToolContext = {
    workspaceRoot: options.workspaceRoot,
    gatewayConfig: options.gateway.getGatewayConfig?.(),
    signal: options.signal,
  };

  if (options.taskId) {
    emitProgress(options, {
      type: "subagent-started",
      taskId: options.taskId,
      description: options.description,
    });
  }

  const finish = async (
    result: string,
    reason: StopBlock["reason"] = "completed",
  ): Promise<string> => {
    if (options.taskId) {
      emitProgress(options, { type: "subagent-finished", taskId: options.taskId });
    }
    await triggerHooks("Stop", {
      event: "Stop",
      scope: "subagent",
      result,
      reason,
    } satisfies StopBlock);
    return result;
  };

  for (let step = 0; step < maxSteps; step += 1) {
    if (options.signal?.aborted) throw new Error("Sub-agent run aborted.");

    const response = await callModelWithRecovery({
      gateway: options.gateway,
      systemPrompt,
      promptPayload: { task: options.description, transcript },
      model: options.model,
      workspaceRoot: options.workspaceRoot,
      threadId: options.taskId ?? "subagent",
      signal: options.signal,
      tools,
      messages: ensureToolResultPairing(modelMessages),
      stream: options.onProgress && options.taskId
        ? {
            onThinkingChunk: (chunk) => emitProgress(options, {
              type: "subagent-thinking-chunk",
              taskId: options.taskId!,
              chunk,
            }),
          }
        : undefined,
      onRecovery: (message) => {
        if (!options.taskId) return;
        emitProgress(options, {
          type: "subagent-tool-started",
          taskId: options.taskId,
          toolName: "recovery",
          message,
        });
      },
    });
    modelMessages.push({ role: "assistant", content: response.content });
    const calls = toolUseBlocksFromContent(response.content);
    if (calls.length === 0) {
      return finish(textFromContentBlocks(response.content));
    }

    const results: AgentModelToolResultBlock[] = [];
    for (const call of calls) {
      const record = (text: string, isError = false): void => {
        results.push({
          type: "tool_result",
          toolUseId: call.id,
          content: [{ type: "text", text }],
          ...(isError ? { isError: true } : {}),
        });
      };

      if (call.parseError) {
        transcript.push({ role: "tool", toolName: call.name, error: call.parseError });
        record(call.parseError, true);
        continue;
      }
      const tool = SUB_AGENT_TOOL_HANDLERS.get(call.name);
      if (!tool) {
        const error = `Unknown tool: ${call.name}. Sub-agents cannot use task.`;
        transcript.push({ role: "tool", toolName: call.name, error });
        record(error, true);
        continue;
      }
      const args = parseToolInput(tool.inputSchema, call.input);
      if (!args.success) {
        transcript.push({ role: "tool", toolName: tool.name, error: args.error.message });
        record(args.error.message, true);
        continue;
      }

      try {
        const preToolStop = await triggerHooks("PreToolUse", {
          event: "PreToolUse",
          toolName: tool.name,
          args: args.data,
          scope: "subagent",
          workspaceRoot: options.workspaceRoot,
          requestToolApproval: options.requestToolApproval,
        });
        if (preToolStop?.toolDenied) {
          const error = preToolStop.reason ?? "Tool call denied.";
          transcript.push({ role: "tool", toolName: tool.name, error });
          record(error, true);
          continue;
        }
        if (preToolStop) return finish(preToolStop.reason);

        if (options.taskId) {
          emitProgress(options, {
            type: "subagent-tool-started",
            taskId: options.taskId,
            toolName: tool.name,
            message: formatSubAgentToolLabel(tool.name, args.data),
          });
        }

        const output = await tool.execute(args.data, toolContext);
        await triggerHooks("PostToolUse", {
          event: "PostToolUse",
          toolName: tool.name,
          args: args.data,
          scope: "subagent",
          result: output,
        } satisfies PostToolUseBlock);
        transcript.push({ role: "tool", toolName: tool.name, result: output });
        record(output);

        if (options.taskId) {
          emitProgress(options, {
            type: "subagent-tool-finished",
            taskId: options.taskId,
            toolName: tool.name,
            message: `完成 ${tool.name}`,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (options.taskId) {
          emitProgress(options, {
            type: "subagent-tool-finished",
            taskId: options.taskId,
            toolName: tool.name,
            message: `失败：${errorMessage}`,
          });
        }
        await triggerHooks("PostToolUse", {
          event: "PostToolUse",
          toolName: tool.name,
          args: args.data,
          scope: "subagent",
          error: errorMessage,
        } satisfies PostToolUseBlock);
        transcript.push({ role: "tool", toolName: tool.name, error: errorMessage });
        record(errorMessage, true);
      }
    }
    modelMessages.push({ role: "user", content: results });
  }

  return finish(buildSubStepLimitMessage(stepLimits), "step_limit");
}

export async function spawnSubAgentsParallel(
  descriptions: string[],
  shared: Omit<SpawnSubAgentOptions, "description">,
): Promise<string[]> {
  return Promise.all(
    descriptions.map((description, index) => spawnSubAgent({
      ...shared,
      description,
      taskId: shared.taskId ? `${shared.taskId}:${index}` : crypto.randomUUID(),
    })),
  );
}

export function formatParallelSubAgentResults(descriptions: string[], conclusions: string[]): string {
  return descriptions.map((description, index) => (
    `## ${description}\n${conclusions[index] ?? "(no conclusion)"}`
  )).join("\n\n");
}
