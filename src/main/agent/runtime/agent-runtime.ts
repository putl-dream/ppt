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
import { toToolSchemas } from "../tools/tool-schema";
import type { AgentModelImageBlock, AgentModelMessage } from "../gateway/types";
import type { SubAgentProgressEvent } from "@shared/subagent-progress";
import {
  buildRenderFeedback,
  extractFeedbackImages,
  formatRenderFeedbackMessage,
  shouldOfferRenderFeedback,
} from "./render-feedback-loop";
import {
  buildAgentJsonRetryMessage,
  parseAgentJsonResponse,
} from "./parse-agent-json-response";

export { parseAgentJsonResponse } from "./parse-agent-json-response";

type ToolCall = {
  type: "tool_call";
  toolName: string;
  args: unknown;
};

/** Derive a display message for sub-agent progress events lacking one. */
function subAgentProgressMessage(event: SubAgentProgressEvent): string {
  switch (event.type) {
    case "subagent-started":
      return `子任务已开始：${event.description}`;
    case "subagent-thinking-chunk":
      return event.chunk;
    case "subagent-tool-started":
    case "subagent-tool-finished":
      return event.message;
    case "subagent-finished":
      return "子任务已完成。";
    default:
      return "";
  }
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
      stageHint: options.stageHint,
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
        ? (event) => options.onProgress?.({
            ...event,
            message: subAgentProgressMessage(event),
          })
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

    // 原生 tool-use：gateway 声明支持时激活。工具 schema 每回合不变，一次构造；
    // nativeMessages 承载多轮 tool_use / tool_result，替代把 transcript 塞进 prompt。
    const useNativeToolUse = this.gateway.supportsNativeToolUse?.() === true;
    const toolSchemas = useNativeToolUse ? toToolSchemas(coreTools) : undefined;
    const nativeMessages: AgentModelMessage[] = [
      ...(options.messageHistory ?? []).map((entry) => ({
        role: entry.role,
        content: entry.content,
      })),
      { role: "user", content: options.request },
    ];
    // 承接上一次工具执行结果，下一回合作为 tool_result 追加。
    // 用 holder 对象而非裸 let，规避闭包赋值下的控制流窄化。
    const pendingToolResult: {
      current: {
        id: string;
        content: string;
        isError?: boolean;
        images?: AgentModelImageBlock[];
      } | null;
    } = {
      current: null,
    };
    let renderFeedbackUsed = false;

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

      const promptPayload = {
        request: options.request,
        conversation: options.messageHistory ?? [],
        transcript,
      };

      // native 模式：把上一回合的工具结果作为 tool_result 追加到消息序列。
      if (useNativeToolUse && pendingToolResult.current) {
        nativeMessages.push({
          role: "user",
          toolResults: [{
            toolCallId: pendingToolResult.current.id,
            content: pendingToolResult.current.content,
            isError: pendingToolResult.current.isError,
            images: pendingToolResult.current.images,
          }],
        });
        pendingToolResult.current = null;
      }

      const extractor = shouldUseStream
        ? new JsonStreamExtractor((text, source) => options.onStreamChunk?.(text, source))
        : null;

      const modelResult = await callModelWithRecovery({
        gateway: this.gateway,
        systemPrompt,
        promptPayload,
        model: options.model,
        workspaceRoot: options.workspaceRoot,
        threadId: options.threadId,
        signal: options.signal,
        tools: toolSchemas,
        messages: useNativeToolUse ? nativeMessages : undefined,
        stream: shouldUseStream
          ? {
              onChunk: (chunk) => {
                if (chunk.type === "content" && chunk.text) {
                  // 即使走原生 tool-use，系统提示仍可能让模型用 JSON 协议回复。
                  // 统一抽取自然语言字段，避免把 {"type":"message",...} 泄露到前端。
                  extractor?.feed(chunk.text);
                }
              },
              onThinkingChunk: (chunk) => {
                options.onThinkingChunk?.(chunk, step);
              },
            }
          : undefined,
        onRecovery: (message) => {
          options.onProgress?.({ type: "request-status", message, progress: 0 });
        },
      });
      const responseText = modelResult.text;

      let parsed: unknown;

      // native 分支：把结构化 toolCall 归一成与文本协议一致的 parsed 形状，
      // 下游校验/hooks/执行/finish 全部原样复用。
      const nativeCall = useNativeToolUse ? modelResult.toolCalls?.[0] : undefined;
      // native 模式下每个 tool_use 必须回配一个 tool_result，否则下一次调用报错。
      // 该闭包在任何 continue 前记录待回传结果；文本模式为 no-op。
      const recordToolResult = (
        content: string,
        isError = false,
        images?: AgentModelImageBlock[],
      ): void => {
        if (nativeCall) {
          pendingToolResult.current = { id: nativeCall.id, content, isError, images };
        }
      };
      if (nativeCall) {
        nativeMessages.push({
          role: "assistant",
          content: responseText || undefined,
          toolCalls: [{ id: nativeCall.id, name: nativeCall.name, args: nativeCall.args }],
          // 开启 thinking 时，带 tool_use 的 assistant 轮须原样回传 thinking 块，
          // 否则下一回合请求被 Anthropic 拒绝。
          thinkingBlocks: modelResult.thinkingBlocks,
        });
        parsed = { type: "tool_call", toolName: nativeCall.name, args: nativeCall.args };
      } else if (useNativeToolUse) {
        // 无结构化工具调用即为最终文本回复；兼容模型仍按文本 JSON 协议返回的情况。
        if (responseText.trim()) {
          nativeMessages.push({
            role: "assistant",
            content: responseText,
            thinkingBlocks: modelResult.thinkingBlocks,
          });
        }
        try {
          parsed = parseAgentJsonResponse(responseText);
        } catch {
          parsed = { type: "message", content: responseText };
        }
      } else {
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
          const guidance =
            "This is an unresolved presentation action. Do not narrate future work. "
            + "Call AskUser if information is still missing, otherwise continue tools and finish with SubmitCommands.";
          transcript.push({
            role: "assistant",
            response: normalized,
            error: guidance,
          });
          // native 模式此处无 tool_use（是纯文本回复），用 user 消息回喂纠偏。
          if (useNativeToolUse) {
            nativeMessages.push({ role: "user", content: guidance });
          }
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
        recordToolResult("Only registered Core Tools can be called directly.", true);
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
        recordToolResult(args.error.message, true);
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
          recordToolResult(preToolStop.reason ?? "Tool call denied.", true);
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

        if (tool.name === "AskUser") {
          return finish(RuntimeNormalizer.normalize(result));
        }

        if (tool.name === "SubmitCommands") {
          const proposal = RuntimeNormalizer.normalize(result);
          if (
            proposal.type === "command_proposal" &&
            shouldOfferRenderFeedback(context.promptStage, proposal.commands, renderFeedbackUsed)
          ) {
            renderFeedbackUsed = true;
            options.onProgress?.({
              type: "render-feedback",
              message: "正在生成排版视觉预览…",
              progress: 0,
            });

            const feedback = await buildRenderFeedback({
              presentation: context.presentation,
              commands: proposal.commands,
              proposalSummary: proposal.summary,
              context,
            });
            const feedbackMessage = formatRenderFeedbackMessage(feedback);
            const feedbackImages = extractFeedbackImages(feedback);

            options.onProgress?.({
              type: "render-feedback-ready",
              message: feedback.hasThumbnails
                ? `已生成 ${feedback.slides.length} 页视觉预览（含缩略图）`
                : `已生成 ${feedback.slides.length} 页结构化预览`,
              progress: 0,
            });

            transcript.push({
              role: "tool",
              toolName: tool.name,
              result: proposal,
              renderFeedback: feedback,
            });

            if (useNativeToolUse) {
              recordToolResult(feedbackMessage, false, feedbackImages);
            } else {
              transcript.push({
                role: "user",
                content: feedbackMessage,
                renderFeedback: true,
              });
            }
            continue;
          }

          return finish(proposal);
        }

        transcript.push({ role: "tool", toolName: tool.name, result });
        recordToolResult(JSON.stringify(result ?? null));
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
        recordToolResult(errorMessage, true);
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
