import type { AgentModelGateway } from "../gateway";
import type { AgentModelSelection } from "@shared/agent";
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
  signal?: AbortSignal;
  requestToolApproval?: ToolApprovalHandler;
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

/**
 * Spawn a sub-agent with a fresh internal transcript. Only the final conclusion
 * is returned to the caller; intermediate messages are discarded.
 */
export async function spawnSubAgent(options: SpawnSubAgentOptions): Promise<string> {
  ensureDefaultHooks();
  const maxSteps = options.maxSteps ?? 30;
  const systemPrompt = buildSubAgentSystemPrompt(SUB_AGENT_TOOLS);
  const transcript: Array<Record<string, unknown>> = [
    { role: "user", content: options.description },
  ];
  const toolContext: SubAgentToolContext = {
    workspaceRoot: options.workspaceRoot,
  };

  const finish = async (
    result: string,
    reason: StopBlock["reason"] = "completed",
  ): Promise<string> => {
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

    const response = await options.gateway.generateText(
      {
        systemPrompt,
        prompt: JSON.stringify({ task: options.description, transcript }),
      },
      options.model,
    );

    let parsed: unknown;
    try {
      parsed = parseAgentJsonResponse(response.text);
    } catch (error) {
      transcript.push({
        role: "assistant",
        raw: response.text.slice(0, 2_000),
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

      const output = await tool.execute(args.data, toolContext);
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

  return finish("Sub-agent reached the step limit before producing a conclusion.", "step_limit");
}

/**
 * Run multiple sub-agents concurrently. Each gets its own messages[] and
 * only its conclusion is returned.
 */
export async function spawnSubAgentsParallel(
  descriptions: string[],
  shared: Omit<SpawnSubAgentOptions, "description">,
): Promise<string[]> {
  return Promise.all(descriptions.map((description) => spawnSubAgent({ ...shared, description })));
}

export function formatParallelSubAgentResults(descriptions: string[], conclusions: string[]): string {
  return descriptions.map((description, index) => (
    `## ${description}\n${conclusions[index] ?? "(no conclusion)"}`
  )).join("\n\n");
}
