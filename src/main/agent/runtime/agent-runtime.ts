import type { AgentModelGateway } from "../gateway";
import type { ToolContext, ToolDiscoverySession } from "../tools/tool-definition";
import { ToolRegistry } from "../tools/tool-registry";
import { RuntimeNormalizer } from "./runtime-normalizer";
import { buildSystemPromptContext, clearSystemPromptCache, getSystemPrompt } from "./system-prompt";
import type { AgentRuntimeOptions, AgentRuntimeResult } from "./runtime-types";
import { JsonStreamExtractor } from "./json-stream-extractor";
import { ensureDefaultHooks } from "./default-hooks";
import { triggerHooks } from "./hook-registry";
import type { PostToolUseBlock, StopBlock, UserPromptSubmitBlock } from "./hook-blocks";
import type { SkillRegistry } from "../skills/loadSkillsDir";
import { createEmptySkillRegistry } from "../skills/loadSkillsDir";
import { createSkillSession, type SkillSession } from "../skills/skill-types";
import {
  buildMainStepLimitMessage,
  getEffectiveMainMaxSteps,
  resolveAgentStepLimits,
} from "@shared/agent-step-limits";
import { callModelWithRecovery } from "./model-call-recovery";
import { createTaskStore } from "../task/task-store";

type ToolCall = {
  type: "tool_call";
  toolName: string;
  args: unknown;
};

export function parseAgentJsonResponse(text: string): unknown {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    const closingTokens: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const token = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (token === "\\") {
          escaped = true;
        } else if (token === '"') {
          inString = false;
        }
        continue;
      }

      if (token === '"') {
        inString = true;
      } else if (token === "{") {
        closingTokens.push("}");
      } else if (token === "[") {
        closingTokens.push("]");
      } else if (token === "}" || token === "]") {
        if (closingTokens.pop() !== token) break;

        if (closingTokens.length === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error("Agent Runtime expected one complete JSON object.");
}

function isToolCall(value: unknown): value is ToolCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "tool_call" && typeof candidate.toolName === "string";
}

/**
 * 模型驱动的 Agent Runtime。模型只能直接调用 Core Tools；Deferred Tools 必须
 * 经 SearchExtraTools 发现，再由 ExecuteExtraTool 路由。
 */
export class AgentRuntime {
  private readonly discoverySessions = new Map<string, ToolDiscoverySession>();
  private readonly skillSessions = new Map<string, SkillSession>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: AgentModelGateway,
    private readonly skillRegistry: SkillRegistry = createEmptySkillRegistry(),
  ) {}

  async run(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
    ensureDefaultHooks();

    const discoverySession = this.discoverySessions.get(options.threadId) ?? {
      discoveredToolNames: new Set<string>(),
    };
    this.discoverySessions.set(options.threadId, discoverySession);

    const skillSession = this.skillSessions.get(options.threadId) ?? createSkillSession();
    this.skillSessions.set(options.threadId, skillSession);

    const taskStore = createTaskStore(options.workspaceRoot);
    const taskGraphOwner = options.taskGraphOwner ?? "agent";

    try {
    const stepLimits = resolveAgentStepLimits(options.agentStepLimits);
    const maxSteps = options.maxSteps ?? getEffectiveMainMaxSteps(stepLimits);
    const coreTools = this.registry.getCoreTools();
    const promptContext = await buildSystemPromptContext({
      request: options.request,
      presentation: options.presentationSnapshot,
      coreTools,
      skillCatalog: this.skillRegistry.listCards(),
      skillRegistry: this.skillRegistry,
      workspaceRoot: options.workspaceRoot,
      currentSlideId: options.currentSlideId,
      messageHistory: options.messageHistory,
      requiredOutcome: options.requiredOutcome,
      stepLimits,
    });
    const { text: systemPrompt } = getSystemPrompt(promptContext, options.threadId);

    const context: ToolContext = {
      presentation: structuredClone(options.presentationSnapshot),
      currentSlideId: options.currentSlideId,
      selectedElementIds: [...options.selectedElementIds],
      discoverySession,
      registry: this.registry,
      messageHistory: options.messageHistory ?? [],
      workspaceRoot: options.workspaceRoot,
      gateway: this.gateway,
      model: options.model,
      signal: options.signal,
      requestToolApproval: options.requestToolApproval,
      notifyTaskGraphUpdated: ({ tasks, goal }) => {
        options.onProgress?.({
          type: "task-graph-updated",
          message: "任务图已更新",
          tasks,
          goal,
        });
      },
      onSubAgentProgress: options.onProgress
        ? (event) => options.onProgress?.(event)
        : undefined,
      agentStepLimits: stepLimits,
      skillRegistry: this.skillRegistry,
      skillSession,
      promptStage: promptContext.stage,
      taskStore,
      taskGraphOwner,
    };
    const transcript: Array<Record<string, unknown>> = [
      { role: "user", content: options.request },
    ];

    const finish = async (
      result: AgentRuntimeResult,
      reason: StopBlock["reason"] = "completed",
    ): Promise<AgentRuntimeResult> => {
      await triggerHooks("Stop", {
        event: "Stop",
        threadId: options.threadId,
        scope: "main",
        result,
        reason,
      } satisfies StopBlock);
      return result;
    };

    const promptBlock: UserPromptSubmitBlock = {
      event: "UserPromptSubmit",
      threadId: options.threadId,
      request: options.request,
      messageHistory: options.messageHistory,
    };
    const promptStop = await triggerHooks("UserPromptSubmit", promptBlock);
    if (promptStop) {
      return finish({
        type: "message",
        content: promptStop.reason,
      });
    }

    for (let step = 0; step < maxSteps; step += 1) {
      if (options.signal?.aborted) {
        throw new Error("Run aborted by user.");
      }

      // 判断是否应该使用流式：仅在可能返回message且提供了回调时使用
      const shouldUseStream = options.onStreamChunk !== undefined;
      let responseText: string;

      const promptPayload = {
        request: options.request,
        conversation: options.messageHistory ?? [],
        transcript,
      };

      if (shouldUseStream) {
        const extractor = new JsonStreamExtractor((text, source) => {
          options.onStreamChunk?.(text, source);
        });
        const modelResult = await callModelWithRecovery({
          gateway: this.gateway,
          systemPrompt,
          promptPayload,
          model: options.model,
          workspaceRoot: options.workspaceRoot,
          threadId: options.threadId,
          signal: options.signal,
          stream: {
            onChunk: (chunk) => {
              if (chunk.type === "content" && chunk.text) {
                extractor.feed(chunk.text);
              }
            },
            onThinkingChunk: (chunk) => {
              options.onThinkingChunk?.(chunk, step);
            },
          },
          onRecovery: (message) => {
            options.onProgress?.({ type: "request-status", message, progress: 0 });
          },
        });
        responseText = modelResult.text;
      } else {
        const modelResult = await callModelWithRecovery({
          gateway: this.gateway,
          systemPrompt,
          promptPayload,
          model: options.model,
          workspaceRoot: options.workspaceRoot,
          threadId: options.threadId,
          signal: options.signal,
          onRecovery: (message) => {
            options.onProgress?.({ type: "request-status", message, progress: 0 });
          },
        });
        responseText = modelResult.text;
      }

      let parsed: unknown;
      try {
        parsed = parseAgentJsonResponse(responseText);
      } catch (error) {
        transcript.push({
          role: "assistant",
          raw: responseText.slice(0, 2_000),
          error: error instanceof Error
            ? `${error.message} Return exactly one complete JSON object.`
            : "Invalid JSON response. Return exactly one complete JSON object.",
        });
        continue;
      }

      if (!isToolCall(parsed)) {
        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as { type?: unknown }).type === "command_proposal"
        ) {
          transcript.push({
            role: "tool",
            error: "Command proposals must be submitted through SubmitCommands.",
          });
          continue;
        }
        let normalized: AgentRuntimeResult;
        try {
          normalized = RuntimeNormalizer.normalize(parsed);
        } catch (error) {
          transcript.push({
            role: "assistant",
            response: parsed,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (normalized.type === "message" && options.requiredOutcome === "command_proposal") {
          transcript.push({
            role: "assistant",
            response: normalized,
            error:
              "This is an unresolved presentation action. Do not narrate future work. "
              + "Call AskUser if information is still missing, otherwise continue tools and finish with SubmitCommands.",
          });
          continue;
        }

        return finish(normalized);
      }

      const tool = this.registry.get(parsed.toolName);
      if (!tool || tool.category !== "core" || tool.loadPolicy !== "core") {
        options.onProgress?.({
          type: "tool-validation-failed",
          toolName: parsed.toolName,
          message: `工具 ${parsed.toolName} 无法直接调用`,
          error: "Only registered Core Tools can be called directly.",
        });
        transcript.push({
          role: "tool",
          toolName: parsed.toolName,
          error: "Only registered Core Tools can be called directly.",
        });
        continue;
      }

      const args = tool.inputSchema.safeParse(parsed.args ?? {});
      if (!args.success) {
        options.onProgress?.({
          type: "tool-validation-failed",
          toolName: tool.name,
          message: `工具 ${tool.name} 参数校验失败`,
          error: args.error.message,
        });
        transcript.push({ role: "tool", toolName: tool.name, error: args.error.message });
        continue;
      }

      try {
        options.onProgress?.({
          type: "tool-started",
          message: `正在调用工具 ${tool.name}...`,
          toolName: tool.name,
        });

        const preToolStop = await triggerHooks("PreToolUse", {
          event: "PreToolUse",
          toolName: tool.name,
          args: args.data,
          scope: "main",
          workspaceRoot: options.workspaceRoot,
          threadId: options.threadId,
          requestToolApproval: options.requestToolApproval,
        });
        if (preToolStop?.toolDenied) {
          options.onProgress?.({
            type: "tool-finished",
            message: `工具 ${tool.name} 被拒绝: ${preToolStop.reason}`,
            toolName: tool.name,
          });
          transcript.push({
            role: "tool",
            toolName: tool.name,
            error: preToolStop.reason,
          });
          continue;
        }
        if (preToolStop) {
          return finish({
            type: "message",
            content: preToolStop.reason,
          });
        }

        const result = await tool.execute(args.data, context);

        await triggerHooks("PostToolUse", {
          event: "PostToolUse",
          toolName: tool.name,
          args: args.data,
          scope: "main",
          result,
          threadId: options.threadId,
        } satisfies PostToolUseBlock);

        options.onProgress?.({
          type: "tool-finished",
          message: `工具 ${tool.name} 执行完成。`,
          toolName: tool.name,
        });

        if (tool.name === "AskUser" || tool.name === "SubmitCommands") {
          return finish(RuntimeNormalizer.normalize(result));
        }
        transcript.push({ role: "tool", toolName: tool.name, result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await triggerHooks("PostToolUse", {
          event: "PostToolUse",
          toolName: tool.name,
          args: args.data,
          scope: "main",
          error: errorMessage,
          threadId: options.threadId,
        } satisfies PostToolUseBlock);
        options.onProgress?.({
          type: "tool-finished",
          message: `工具 ${tool.name} 执行失败: ${errorMessage}`,
          toolName: tool.name,
        });
        transcript.push({
          role: "tool",
          toolName: tool.name,
          error: errorMessage,
        });
      }

    }

    if (options.requiredOutcome === "command_proposal") {
      throw new Error(
        "Agent reached the tool-step limit before resolving the presentation action. "
        + "The conversation remains active and can be continued.",
      );
    }

    return finish({
      type: "message",
      content: buildMainStepLimitMessage(stepLimits),
    }, "step_limit");
    } finally {
      if (taskStore) {
        await taskStore.unassignInProgressByOwner(taskGraphOwner);
      }
    }
  }

  clearSession(threadId: string): void {
    this.discoverySessions.delete(threadId);
    this.skillSessions.delete(threadId);
    clearSystemPromptCache(threadId);
  }
}
