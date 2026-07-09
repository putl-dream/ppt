import type { AgentModelGateway } from "../gateway";
import type { ToolContext, ToolDiscoverySession } from "../tools/tool-definition";
import { ToolRegistry } from "../tools/tool-registry";
import { buildSystemPromptContext, clearSystemPromptCache, getSystemPrompt } from "./system-prompt";
import type { AgentProtocolEnvelope, AgentRuntimeOptions, AgentRuntimeResult } from "./runtime-types";
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
import { isTaskPlanActive } from "@shared/agent-task-graph";
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
import {
  normalizeMarkdownAssistantMessage,
  normalizeAgentProtocolObject,
  normalizeModelResponseToEnvelope,
} from "./agent-message-normalizer";
import {
  BackgroundTaskManager,
  describeBackgroundTask,
  formatBackgroundNotifications,
  shouldRunBackground,
} from "./background-task-manager";
import {
  formatMailboxMessagesForHistory,
  type AgentMailboxMessage,
} from "../teammate/message-bus";

export { parseAgentJsonResponse } from "./parse-agent-json-response";

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

async function shouldRequireDiscoverTaskPlan(input: {
  stage?: string;
  toolName: string;
  taskStore?: ReturnType<typeof createTaskStore>;
}): Promise<boolean> {
  if (input.stage !== "discover") return false;
  if (!input.taskStore) return false;
  if (input.toolName === "AskUser" || input.toolName.startsWith("TaskGraph")) return false;

  const tasks = await input.taskStore.listTasks();
  return !isTaskPlanActive(tasks);
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
      messageBus: options.messageBus,
      teammateManager: options.teammateManager,
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
    const backgroundTasks = new BackgroundTaskManager();

    const appendNativeUserTurn = (input: {
      content?: string;
      toolResult?: NonNullable<typeof pendingToolResult.current>;
    }): void => {
      if (!useNativeToolUse) return;
      const content = input.content?.trim();
      if (!input.toolResult && !content) return;

      if (!input.toolResult && content) {
        const last = nativeMessages.at(-1);
        if (last?.role === "user" && !last.toolResults?.length && !last.images?.length) {
          last.content = [last.content, content].filter((part): part is string => Boolean(part?.trim()))
            .join("\n\n");
          return;
        }
      }

      nativeMessages.push({
        role: "user",
        ...(content ? { content } : {}),
        ...(input.toolResult
          ? {
              toolResults: [{
                toolCallId: input.toolResult.id,
                content: input.toolResult.content,
                isError: input.toolResult.isError,
                images: input.toolResult.images,
              }],
            }
          : {}),
      });
    };

    const flushNativeUserTurn = (content?: string): void => {
      const toolResult = pendingToolResult.current ?? undefined;
      appendNativeUserTurn({ content, toolResult });
      if (toolResult) pendingToolResult.current = null;
    };

    const handleLeadPermissionRequest = async (
      message: AgentMailboxMessage,
    ): Promise<string> => {
      const payload = message.payload ?? {};
      const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
      const toolName = typeof payload.toolName === "string" ? payload.toolName : "unknown";
      const reason = typeof payload.reason === "string" ? payload.reason : message.content;
      const args = payload.args;
      const approved = options.requestToolApproval
        ? await options.requestToolApproval({ toolName, args, reason })
        : false;

      await options.messageBus?.send({
        from: "lead",
        to: message.from,
        type: "permission_response",
        content: approved ? "Permission approved by lead." : "Permission denied by lead.",
        payload: {
          requestId,
          approved,
          toolName,
          reason,
        },
      });

      return `Permission request from ${message.from} for ${toolName} was ${approved ? "approved" : "denied"} and the response was sent.`;
    };

    const drainLeadInboxForModel = async (): Promise<string | undefined> => {
      if (!options.messageBus) return undefined;
      const inbox = await options.messageBus.readInbox("lead");
      if (inbox.length === 0) return undefined;

      const visibleMessages: AgentMailboxMessage[] = [];
      const systemNotes: string[] = [];
      for (const message of inbox) {
        if (message.type === "permission_request") {
          systemNotes.push(await handleLeadPermissionRequest(message));
        } else {
          visibleMessages.push(message);
        }
      }

      const parts = [
        visibleMessages.length > 0
          ? `[Inbox]\n${formatMailboxMessagesForHistory(visibleMessages)}`
          : "",
        systemNotes.length > 0
          ? `[Inbox permissions]\n${systemNotes.join("\n")}`
          : "",
      ].filter(Boolean);
      if (parts.length === 0) return undefined;

      const content = parts.join("\n\n");
      transcript.push({
        role: "user",
        content,
        inbox,
      });
      return content;
    };

    const drainBackgroundForModel = async (instruction: string): Promise<boolean> => {
      if (!useNativeToolUse) return false;
      if (!backgroundTasks.hasRunning() && !backgroundTasks.hasPendingNotifications()) return false;
      const notifications = await backgroundTasks.drain(options.signal);
      if (notifications.length === 0) return false;
      flushNativeUserTurn(`${formatBackgroundNotifications(notifications)}\n\n${instruction}`);
      return true;
    };

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
        ...normalizeMarkdownAssistantMessage(promptStop.reason),
      });
    }

    for (let step = 0; step < maxSteps; step += 1) {
      if (options.signal?.aborted) {
        throw new Error("Run aborted by user.");
      }

      // 判断是否应该使用流式：仅在可能返回message且提供了回调时使用
      const shouldUseStream = options.onStreamChunk !== undefined;

      const inboxContent = await drainLeadInboxForModel();

      const promptPayload = {
        request: options.request,
        conversation: options.messageHistory ?? [],
        transcript,
      };

      // native 模式：把上一回合 tool_result 与已完成后台任务通知并入同一 user turn。
      if (useNativeToolUse) {
        const notifications = backgroundTasks.collect();
        const nativeUserContent = [
          notifications.length > 0 ? formatBackgroundNotifications(notifications) : "",
          inboxContent ?? "",
        ].filter((part) => part.trim()).join("\n\n");
        flushNativeUserTurn(nativeUserContent || undefined);
      }

      const extractor = shouldUseStream
        ? new JsonStreamExtractor(
            (text, source) => options.onStreamChunk?.(text, source),
            {
              streamMarkdown: false,
            },
          )
        : null;

      const modelResult = await callModelWithRecovery({
        gateway: this.gateway,
        systemPrompt,
        responseContract: "agent-protocol",
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
                  // 统一抽取自然语言字段，避免把协议 envelope 泄露到前端。
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

      let envelope: AgentProtocolEnvelope;

      // native 分支：把结构化 toolCall 或文本协议统一归一成 envelope，
      // 下游只处理 { type, data }。
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
        envelope = normalizeModelResponseToEnvelope({
          text: responseText,
          toolCalls: [nativeCall],
        });
      } else if (useNativeToolUse) {
        // 无结构化工具调用即为最终文本回复；仍必须遵守 JSON envelope 协议。
        if (responseText.trim()) {
          nativeMessages.push({
            role: "assistant",
            content: responseText,
            thinkingBlocks: modelResult.thinkingBlocks,
          });
        }
        try {
          const parsed = parseAgentJsonResponse(responseText);
          envelope = normalizeAgentProtocolObject(parsed);
        } catch (error) {
          const guidance = buildAgentJsonRetryMessage(error);
          transcript.push({
            role: "assistant",
            raw: responseText.slice(0, 2_000),
            error: guidance,
          });
          nativeMessages.push({ role: "user", content: guidance });
          continue;
        }
      } else {
        let parsed: unknown;
        try {
          parsed = parseAgentJsonResponse(responseText);
        } catch (error) {
          const guidance = buildAgentJsonRetryMessage(error);
          transcript.push({
            role: "assistant",
            raw: responseText.slice(0, 2_000),
            error: guidance,
          });
          transcript.push({ role: "user", content: guidance });
          continue;
        }
        try {
          envelope = normalizeAgentProtocolObject(parsed);
        } catch (error) {
          const guidance = buildAgentJsonRetryMessage(error, parsed);
          transcript.push({
            role: "assistant",
            response: parsed,
            error: guidance,
          });
          transcript.push({ role: "user", content: guidance });
          continue;
        }
      }

      if (envelope.type !== "tool.call") {
        if (envelope.type === "deck.command_proposal") {
          transcript.push({
            role: "tool",
            error: "Command proposals must be submitted through SubmitCommands.",
          });
          continue;
        }
        const normalized = envelope;

        if (normalized.type === "assistant.message" && options.requiredOutcome === "command_proposal") {
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

        if (await drainBackgroundForModel(
          "Background tasks have completed. Use these results before giving the final response.",
        )) {
          continue;
        }

        const finalInboxContent = await drainLeadInboxForModel();
        if (finalInboxContent) {
          if (useNativeToolUse) {
            appendNativeUserTurn({ content: finalInboxContent });
          }
          continue;
        }

        return finish(normalized);
      }

      const tool = this.registry.get(envelope.data.toolName);
      if (!tool || tool.category !== "core" || tool.loadPolicy !== "core") {
        options.onProgress?.({
          type: "tool-validation-failed",
          toolName: envelope.data.toolName,
          message: `工具 ${envelope.data.toolName} 无法直接调用`,
          error: "Only registered Core Tools can be called directly.",
        });
        transcript.push({
          role: "tool",
          toolName: envelope.data.toolName,
          error: "Only registered Core Tools can be called directly.",
        });
        recordToolResult("Only registered Core Tools can be called directly.", true);
        continue;
      }

      const args = tool.inputSchema.safeParse(envelope.data.args ?? {});
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

      if (await shouldRequireDiscoverTaskPlan({
        stage: context.promptStage,
        toolName: tool.name,
        taskStore,
      })) {
        const guidance =
          "Full or multi-step PPT creation in the discover stage must start with "
          + "TaskGraphCreatePlan(sequential=true, 3-5 concrete steps) before LoadSkill, Task, "
          + "ReadPresentationSnapshot, or other execution tools. Create the visible task plan first, "
          + "then claim and complete each step as work progresses.";
        options.onProgress?.({
          type: "workflow-progress",
          message: "正在先建立可见任务计划...",
          progress: 0,
        });
        transcript.push({
          role: "tool",
          toolName: tool.name,
          error: guidance,
        });
        recordToolResult(guidance, true);
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
            ...normalizeMarkdownAssistantMessage(preToolStop.reason),
          });
        }

        if (
          useNativeToolUse
          && (tool.name === "SubmitCommands" || tool.name === "AskUser")
          && (backgroundTasks.hasRunning() || backgroundTasks.hasPendingNotifications())
        ) {
          const guidance =
            `Paused ${tool.name} because background task results are not yet incorporated. `
            + "Review the task_notification content, then call the appropriate finish tool again.";
          transcript.push({
            role: "tool",
            toolName: tool.name,
            result: { pausedForBackgroundTasks: true, guidance },
          });
          recordToolResult(guidance);
          await drainBackgroundForModel(
            "Background tasks have completed. Reconsider these results before calling a finish tool.",
          );
          options.onProgress?.({
            type: "tool-finished",
            message: `工具 ${tool.name} 已等待后台任务结果。`,
            toolName: tool.name,
          });
          continue;
        }

        if (
          useNativeToolUse
          && shouldRunBackground(tool.name, args.data as Record<string, unknown>)
        ) {
          const label = describeBackgroundTask(tool.name, args.data as Record<string, unknown>);
          let bgId = "";
          bgId = backgroundTasks.start({
            toolName: tool.name,
            label,
            run: async () => {
              try {
                const output = await tool.execute(args.data, context);
                await triggerHooks("PostToolUse", {
                  event: "PostToolUse",
                  toolName: tool.name,
                  args: args.data,
                  scope: "main",
                  result: output,
                  threadId: options.threadId,
                } satisfies PostToolUseBlock);
                options.onProgress?.({
                  type: "tool-finished",
                  message: `后台任务 ${bgId} 已完成：${tool.name}`,
                  toolName: tool.name,
                });
                return output;
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
                  message: `后台任务 ${bgId} 执行失败：${errorMessage}`,
                  toolName: tool.name,
                });
                throw error;
              }
            },
          });

          const placeholder =
            `[Background task ${bgId} started: ${label}] `
            + "Result will arrive later as task_notification. Continue with independent work.";
          transcript.push({
            role: "tool",
            toolName: tool.name,
            result: { backgroundTaskId: bgId, status: "running", label },
          });
          recordToolResult(placeholder);
          options.onProgress?.({
            type: "workflow-progress",
            message: `后台任务 ${bgId} 已启动：${label}`,
            progress: 0,
          });
          continue;
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
          const askUser = normalizeAgentProtocolObject(result);
          if (askUser.type !== "assistant.ask_user") {
            throw new Error("AskUser must return an assistant.ask_user envelope.");
          }
          return finish(askUser);
        }

        if (tool.name === "SubmitCommands") {
          const proposal = normalizeAgentProtocolObject(result);
          if (proposal.type !== "deck.command_proposal") {
            throw new Error("SubmitCommands must return a deck.command_proposal envelope.");
          }
          if (
            shouldOfferRenderFeedback(context.promptStage, proposal.data.commands, renderFeedbackUsed)
          ) {
            renderFeedbackUsed = true;
            options.onProgress?.({
              type: "render-feedback",
              message: "正在生成排版视觉预览…",
              progress: 0,
            });

            const feedback = await buildRenderFeedback({
              presentation: context.presentation,
              commands: proposal.data.commands,
              proposalSummary: proposal.data.summary,
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

    if (backgroundTasks.hasRunning()) {
      await backgroundTasks.drain(options.signal);
    }

    if (options.requiredOutcome === "command_proposal") {
      throw new Error(
        "Agent reached the tool-step limit before resolving the presentation action. "
        + "The conversation remains active and can be continued.",
      );
    }

    return finish({
      ...normalizeMarkdownAssistantMessage(buildMainStepLimitMessage(stepLimits)),
    }, "step_limit");
    } finally {
      if (taskStore) {
        const released = await taskStore.unassignInProgressByOwner(taskGraphOwner);
        if (released.length > 0) {
          const tasks = await taskStore.listTasks();
          const plan = await taskStore.getPlanMeta();
          options.onProgress?.({
            type: "task-graph-updated",
            message: "任务图已更新",
            tasks,
            goal: plan?.goal ?? null,
          });
        }
      }
    }
  }

  clearSession(threadId: string): void {
    this.discoverySessions.delete(threadId);
    this.skillSessions.delete(threadId);
    clearSystemPromptCache(threadId);
  }
}
