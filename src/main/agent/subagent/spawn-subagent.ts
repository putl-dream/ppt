import type { AgentModelGateway } from "../gateway";
import type { AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { SubAgentProgressListener } from "@shared/subagent-progress";
import { formatSubAgentToolLabel } from "@shared/subagent-progress";
import {
  buildSubStepLimitMessage,
  getEffectiveSubMaxSteps,
  resolveAgentStepLimits,
} from "@shared/agent-step-limits";
import {
  buildAgentJsonRetryMessage,
  parseAgentJsonResponse,
} from "../runtime/parse-agent-json-response";
import {
  normalizeAgentProtocolObject,
} from "../runtime/agent-message-normalizer";
import type { AgentProtocolEnvelope } from "../runtime/runtime-types";
import { ensureDefaultHooks } from "../runtime/default-hooks";
import { triggerHooks } from "../runtime/hook-registry";
import type { PostToolUseBlock, StopBlock } from "../runtime/hook-blocks";
import type { ToolApprovalHandler } from "../runtime/permission-check";
import { buildSubAgentSystemPrompt } from "./sub-system-prompt";
import { callModelWithRecovery } from "../runtime/model-call-recovery";
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

function extractTextFromEnvelope(envelope: AgentProtocolEnvelope): string {
  switch (envelope.type) {
    case "assistant.message":
      return envelope.data.content;
    case "assistant.ask_user":
      return envelope.data.content;
    case "deck.command_proposal":
      return envelope.data.summary;
    case "tool.call":
      return JSON.stringify(envelope.data);
  }
}

function emitProgress(options: SpawnSubAgentOptions, event: Parameters<SubAgentProgressListener>[0]): void {
  if (!options.taskId || !options.onProgress) return;
  options.onProgress(event);
}

async function generateSubAgentResponse(
  options: SpawnSubAgentOptions,
  systemPrompt: string,
  transcript: Array<Record<string, unknown>>,
): Promise<string> {
  const result = await callModelWithRecovery({
    gateway: options.gateway,
    systemPrompt,
    promptPayload: {
      task: options.description,
      transcript,
    },
    model: options.model,
    workspaceRoot: options.workspaceRoot,
    threadId: options.taskId ?? "subagent",
    signal: options.signal,
    stream: options.onProgress && options.taskId
      ? {
          onThinkingChunk: (chunk) => {
            emitProgress(options, {
              type: "subagent-thinking-chunk",
              taskId: options.taskId!,
              chunk,
            });
          },
        }
      : undefined,
    onRecovery: (message) => {
      if (options.taskId) {
        emitProgress(options, {
          type: "subagent-tool-started",
          taskId: options.taskId,
          toolName: "recovery",
          message,
        });
      }
    },
  });
  return result.text;
}

/**
 * Spawn a sub-agent with a fresh internal transcript. Only the final conclusion
 * is returned to the caller; intermediate messages are discarded.
 */
export async function spawnSubAgent(options: SpawnSubAgentOptions): Promise<string> {
  ensureDefaultHooks();
  const stepLimits = resolveAgentStepLimits(options.agentStepLimits);
  const maxSteps = options.maxSteps ?? getEffectiveSubMaxSteps(stepLimits);
  const systemPrompt = buildSubAgentSystemPrompt(SUB_AGENT_TOOLS);
  const transcript: Array<Record<string, unknown>> = [
    { role: "user", content: options.description },
  ];
  const toolContext: SubAgentToolContext = {
    workspaceRoot: options.workspaceRoot,
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
    if (options.signal?.aborted) {
      throw new Error("Sub-agent run aborted.");
    }

    const responseText = await generateSubAgentResponse(options, systemPrompt, transcript);

    let parsed: unknown;
    try {
      parsed = parseAgentJsonResponse(responseText);
    } catch (error) {
      transcript.push({
        role: "assistant",
        raw: responseText.slice(0, 2_000),
        error: buildAgentJsonRetryMessage(error),
      });
      continue;
    }

    let envelope: AgentProtocolEnvelope;
    try {
      envelope = normalizeAgentProtocolObject(parsed);
    } catch (error) {
      transcript.push({
        role: "assistant",
        response: parsed,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (envelope.type !== "tool.call") {
      return finish(extractTextFromEnvelope(envelope));
    }

    const tool = SUB_AGENT_TOOL_HANDLERS.get(envelope.data.toolName);
    if (!tool) {
      transcript.push({
        role: "tool",
        toolName: envelope.data.toolName,
        error: `Unknown tool: ${envelope.data.toolName}. Sub-agents cannot use task.`,
      });
      continue;
    }

    const args = tool.inputSchema.safeParse(envelope.data.args ?? {});
    if (!args.success) {
      transcript.push({
        role: "tool",
        toolName: tool.name,
        error: args.error.message,
      });
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
        transcript.push({
          role: "tool",
          toolName: tool.name,
          error: preToolStop.reason,
        });
        continue;
      }
      if (preToolStop) {
        return finish(preToolStop.reason);
      }

      if (options.taskId) {
        emitProgress(options, {
          type: "subagent-tool-started",
          taskId: options.taskId,
          toolName: tool.name,
          message: formatSubAgentToolLabel(tool.name, args.data),
        });
      }

      const output = await tool.execute(args.data, toolContext);

      if (options.taskId) {
        emitProgress(options, {
          type: "subagent-tool-finished",
          taskId: options.taskId,
          toolName: tool.name,
          message: `完成 ${tool.name}`,
        });
      }

      await triggerHooks("PostToolUse", {
        event: "PostToolUse",
        toolName: tool.name,
        args: args.data,
        scope: "subagent",
        result: output,
      } satisfies PostToolUseBlock);
      transcript.push({ role: "tool", toolName: tool.name, result: output });
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
      transcript.push({
        role: "tool",
        toolName: tool.name,
        error: errorMessage,
      });
    }
  }

  return finish(buildSubStepLimitMessage(stepLimits), "step_limit");
}

/**
 * Run multiple sub-agents concurrently. Each gets its own messages[] and
 * only its conclusion is returned.
 */
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
