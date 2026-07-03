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
import { parseAgentJsonResponse } from "../runtime/agent-runtime";
import { RuntimeNormalizer } from "../runtime/runtime-normalizer";
import { ensureDefaultHooks } from "../runtime/default-hooks";
import { triggerHooks } from "../runtime/hook-registry";
import type { PostToolUseBlock, StopBlock } from "../runtime/hook-blocks";
import type { ToolApprovalHandler } from "../runtime/permission-check";
import { buildSubAgentSystemPrompt } from "./sub-system-prompt";
import {
  SUB_AGENT_TOOL_HANDLERS,
  SUB_AGENT_TOOLS,
  type SubAgentToolContext,
} from "./workspace-tools";

type SubAgentToolCall = {
  type: "tool_call";
  toolName: string;
  args: unknown;
};

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

function isToolCall(value: unknown): value is SubAgentToolCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "tool_call" && typeof candidate.toolName === "string";
}

function extractTextFromNormalized(result: { type: string; content?: string; message?: string }): string {
  if (result.type === "message" && result.content) return result.content;
  if (result.type === "ask_user" && result.message) return result.message;
  return JSON.stringify(result);
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
  const request = {
    systemPrompt,
    prompt: JSON.stringify({ task: options.description, transcript }),
    signal: options.signal,
  };

  if (options.onProgress && options.taskId) {
    let accumulatedText = "";
    for await (const chunk of options.gateway.generateTextStream(request, options.model)) {
      if (options.signal?.aborted) {
        throw new Error("Sub-agent run aborted.");
      }
      if (chunk.type === "thinking" && chunk.text) {
        emitProgress(options, {
          type: "subagent-thinking-chunk",
          taskId: options.taskId,
          chunk: chunk.text,
        });
      } else if (chunk.type === "content") {
        accumulatedText += chunk.text;
      }
    }
    return accumulatedText;
  }

  const response = await options.gateway.generateText(request, options.model);
  return response.text;
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
        error: error instanceof Error
          ? `${error.message} Return exactly one complete JSON object.`
          : "Invalid JSON response.",
      });
      continue;
    }

    if (!isToolCall(parsed)) {
      try {
        const normalized = RuntimeNormalizer.normalize(parsed);
        return finish(extractTextFromNormalized(normalized));
      } catch (error) {
        transcript.push({
          role: "assistant",
          response: parsed,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    const tool = SUB_AGENT_TOOL_HANDLERS.get(parsed.toolName);
    if (!tool) {
      transcript.push({
        role: "tool",
        toolName: parsed.toolName,
        error: `Unknown tool: ${parsed.toolName}. Sub-agents cannot use task.`,
      });
      continue;
    }

    const args = tool.inputSchema.safeParse(parsed.args ?? {});
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
