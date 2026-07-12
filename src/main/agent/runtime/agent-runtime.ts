import type { AgentModelGateway } from "../gateway";
import type { ToolContext, ToolDiscoverySession } from "../tools/tool-definition";
import { ToolRegistry } from "../tools/tool-registry";
import { buildSystemPromptContext, clearSystemPromptCache, getSystemPrompt } from "./system-prompt";
import {
  agentAskUserResultSchema,
  agentCommandProposalResultSchema,
  type AgentRuntimeOptions,
  type AgentRuntimeResult,
} from "./runtime-types";
import { ensureDefaultHooks } from "./default-hooks";
import { triggerHooks } from "./hook-registry";
import type { PostToolUseBlock, StopBlock, UserPromptSubmitBlock } from "./hook-blocks";
import type { SkillRegistry } from "../skills/loadSkillsDir";
import { createEmptySkillRegistry } from "../skills/loadSkillsDir";
import type { SkillSession } from "../skills/skill-types";
import {
  buildMainStepLimitMessage,
  getEffectiveMainMaxSteps,
  resolveAgentStepLimits,
} from "@shared/agent-step-limits";
import { filterTasksByPlan, isTaskPlanActive } from "@shared/agent-task-graph";
import { callModelWithRecovery } from "./model-call-recovery";
import { createTaskStore } from "../task/task-store";
import { toToolSchemas } from "../tools/tool-schema";
import type {
  AgentModelMessage,
  AgentModelToolResultBlock,
  AgentModelToolUseBlock,
} from "../gateway/types";
import { ensureToolResultPairing } from "../gateway/message-pairing";
import { textFromContentBlocks, toolUseBlocksFromContent } from "../gateway/content-blocks";
import { validateToolOutput } from "../tools/tool-validation";
import { parseDefinedToolInput } from "../tools/tool-input";
import { prepareToolResultData } from "./tool-result-data";
import type { SubAgentProgressEvent } from "@shared/subagent-progress";
import {
  buildRenderFeedback,
  extractFeedbackImages,
  formatRenderFeedbackMessage,
  shouldOfferRenderFeedback,
} from "./render-feedback-loop";
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
import {
  DurableRunStore,
  type DurableRunCheckpoint,
  type DurableRunPhase,
  type DurableRunStatus,
} from "../persistence/durable-run-store";
import { prepareLayoutChoiceTask } from "./layout-choice-orchestrator";
import type { ConversationDatabase } from "../../conversation-database";

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
    private readonly conversationDatabase?: ConversationDatabase,
  ) {}

  async run(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
    ensureDefaultHooks();

    const durableRunStore = this.conversationDatabase
      ? new DurableRunStore(this.conversationDatabase)
      : options.workspaceRoot
        ? new DurableRunStore(options.workspaceRoot)
        : undefined;
    const recovered = options.resumeThread
      ? await durableRunStore?.load(options.threadId)
      : undefined;
    const checkpointCreatedAt = recovered?.createdAt ?? new Date().toISOString();

    const discoverySession = this.discoverySessions.get(options.threadId) ?? {
      discoveredToolNames: new Set<string>(recovered?.discoveredToolNames ?? []),
    };
    this.discoverySessions.set(options.threadId, discoverySession);

    const skillSession = this.skillSessions.get(options.threadId) ?? {
      loadedSkillNames: new Set<string>(recovered?.loadedSkillNames ?? []),
    };
    this.skillSessions.set(options.threadId, skillSession);

    const taskStore = createTaskStore(options.runtimeRoot);
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
    if (options.layoutChoice) {
      if (!taskStore || !options.workspaceRoot) {
        throw new Error("Layout choice requires a configured workspace task board.");
      }
      const prepared = await prepareLayoutChoiceTask({
        choice: options.layoutChoice,
        presentation: options.presentationSnapshot,
        workspaceRoot: options.workspaceRoot,
        taskStore,
        toolContext: context,
      });
      options.onProgress?.({
        type: "workflow-progress",
        message: prepared.message,
        progress: 20,
      });
      return { type: "message", content: prepared.message };
    }
    const transcript: Array<Record<string, unknown>> = recovered
      ? [...structuredClone(recovered.transcript), { role: "user", content: options.request }]
      : [{ role: "user", content: options.request }];

    const toolSchemas = toToolSchemas(coreTools);
    const recoveredPendingToolResults = structuredClone(recovered?.pendingToolResults ?? []);
    const modelMessages: AgentModelMessage[] = recovered
      ? structuredClone(recovered.modelMessages)
      : [
          ...(options.messageHistory ?? []).map((entry) => ({
            role: entry.role,
            content: [{ type: "text" as const, text: entry.content }],
          })),
          { role: "user", content: [{ type: "text", text: options.request }] },
        ];
    const pendingToolResults: { current: AgentModelToolResultBlock[] } = {
      current: recoveredPendingToolResults,
    };
    const queuedToolUses: AgentModelToolUseBlock[] = structuredClone(
      recovered?.queuedToolUses ?? [],
    );
    const validationFailuresByTool = new Map<string, number>();
    const pendingUserContent: string[] = [...(recovered?.pendingUserContent ?? [])];
    let renderFeedbackUsed = recovered?.renderFeedbackUsed ?? false;
    let activeToolUse = recovered?.activeToolUse
      ? structuredClone(recovered.activeToolUse)
      : undefined;
    let checkpointPhase: DurableRunPhase = recovered?.phase ?? "before_model";
    let totalModelSteps = recovered?.modelStep ?? 0;
    const backgroundTasks = new BackgroundTaskManager();

    if (recovered?.phase === "tool_running" && activeToolUse) {
      const alreadyRecorded = pendingToolResults.current.some(
        (item) => item.toolUseId === activeToolUse?.id,
      );
      if (!alreadyRecorded) {
        pendingToolResults.current.push({
          type: "tool_result",
          toolUseId: activeToolUse.id,
          isError: true,
          content: [{
            type: "text",
            text: "The application restarted while this tool was running. Its side effects are uncertain. Inspect durable workspace artifacts and task state before deciding whether to retry; do not assume either success or failure.",
          }],
        });
      }
      transcript.push({
        role: "system",
        kind: "recovery",
        toolUseId: activeToolUse.id,
        toolName: activeToolUse.name,
        content: "Recovered an interrupted tool boundary; side effects require reconciliation.",
      });
      activeToolUse = undefined;
      checkpointPhase = "tool_committed";
    }

    if (
      recovered
      && (recovered.status === "running" || recovered.status === "interrupted" || recovered.status === "failed")
    ) {
      const interruptedBackgroundTasks = recovered.transcript.flatMap((entry) => {
        const result = entry.result;
        if (!result || typeof result !== "object" || Array.isArray(result)) return [];
        const record = result as Record<string, unknown>;
        if (record.status !== "running" || typeof record.backgroundTaskId !== "string") return [];
        return [{
          id: record.backgroundTaskId,
          toolName: typeof entry.toolName === "string" ? entry.toolName : "background-task",
        }];
      });
      if (interruptedBackgroundTasks.length > 0) {
        const recoveryNotice = interruptedBackgroundTasks.map((task) => [
          "<task_notification>",
          `  <task_id>${task.id}</task_id>`,
          "  <status>failed</status>",
          `  <tool>${task.toolName}</tool>`,
          "  <error>The application restarted before this background task committed its result. Inspect durable artifacts before retrying.</error>",
          "</task_notification>",
        ].join("\n")).join("\n\n");
        pendingUserContent.push(recoveryNotice);
        transcript.push({
          role: "system",
          kind: "recovery",
          content: recoveryNotice,
        });
      }
    }

    if (recovered) {
      const continuationText = [options.request, ...pendingUserContent.splice(0)]
        .filter((part) => part.trim())
        .join("\n\n");
      if (checkpointPhase === "model_committed" && queuedToolUses.length > 0) {
        pendingUserContent.push(continuationText);
      } else if (pendingToolResults.current.length > 0) {
        modelMessages.push({
          role: "user",
          content: [
            ...pendingToolResults.current,
            { type: "text", text: continuationText },
          ],
        });
        pendingToolResults.current = [];
      } else {
        const last = modelMessages.at(-1);
        if (last?.role === "user" && !last.content.some((block) => block.type === "tool_result")) {
          last.content.push({ type: "text", text: continuationText });
        } else {
          modelMessages.push({
            role: "user",
            content: [{ type: "text", text: continuationText }],
          });
        }
      }
    }

    const persistCheckpoint = async (input?: {
      status?: DurableRunStatus;
      phase?: DurableRunPhase;
      result?: AgentRuntimeResult;
      error?: string;
    }): Promise<void> => {
      if (!durableRunStore) return;
      const now = new Date().toISOString();
      const checkpoint: DurableRunCheckpoint = {
        version: 1,
        threadId: options.threadId,
        runId: options.runId,
        status: input?.status ?? "running",
        phase: input?.phase ?? checkpointPhase,
        request: options.request,
        model: options.model,
        executionStrategy: options.executionStrategy,
        baseRevision: options.presentationSnapshot.revision,
        modelStep: totalModelSteps,
        modelMessages: structuredClone(modelMessages),
        transcript: structuredClone(transcript),
        queuedToolUses: structuredClone(queuedToolUses),
        pendingToolResults: structuredClone(pendingToolResults.current),
        pendingUserContent: [...pendingUserContent],
        discoveredToolNames: [...discoverySession.discoveredToolNames].sort(),
        loadedSkillNames: [...skillSession.loadedSkillNames].sort(),
        renderFeedbackUsed,
        activeToolUse: activeToolUse ? structuredClone(activeToolUse) : undefined,
        result: input?.result,
        error: input?.error,
        createdAt: checkpointCreatedAt,
        updatedAt: now,
      };
      await durableRunStore.save(checkpoint);
    };

    const appendUserTurn = (input: {
      text?: string;
      toolResults?: AgentModelToolResultBlock[];
    }): void => {
      const text = input.text?.trim();
      const toolResults = input.toolResults?.length ? input.toolResults : undefined;
      if (!toolResults && !text) return;

      if (!toolResults && text) {
        const last = modelMessages.at(-1);
        if (last?.role === "user" && !last.content.some((block) => block.type === "tool_result")) {
          last.content.push({ type: "text", text });
          return;
        }
      }

      modelMessages.push({
        role: "user",
        content: [
          ...(toolResults ?? []),
          ...(text ? [{ type: "text" as const, text }] : []),
        ],
      });
    };

    const flushUserTurn = (text?: string): void => {
      const toolResults = pendingToolResults.current.length
        ? [...pendingToolResults.current]
        : undefined;
      appendUserTurn({ text, toolResults });
      pendingToolResults.current = [];
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
      const inbox = options.teammateManager
        ? await options.teammateManager.consumeLeadInbox()
        : await options.messageBus.readInbox("lead");
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
      if (!backgroundTasks.hasRunning() && !backgroundTasks.hasPendingNotifications()) return false;
      const notifications = await backgroundTasks.drain(options.signal);
      if (notifications.length === 0) return false;
      const content = `${formatBackgroundNotifications(notifications)}\n\n${instruction}`;
      if (queuedToolUses.length > 0) {
        // Keep the assistant batch contiguous: all tool results must be in the
        // first user turn after it, even when a background task finishes early.
        pendingUserContent.push(content);
      } else {
        flushUserTurn(content);
      }
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
      checkpointPhase = "finished";
      await persistCheckpoint({
        status: result.type === "ask_user"
          ? "waiting_user"
          : result.type === "command_proposal"
            ? "proposal_ready"
            : "completed",
        phase: "finished",
        result,
      });
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
      return finish({ type: "message", content: promptStop.reason });
    }

    let runModelSteps = 0;
    while (runModelSteps < maxSteps || queuedToolUses.length > 0) {
      if (options.signal?.aborted) {
        await persistCheckpoint({ status: "interrupted" });
        throw new Error("Run aborted by user.");
      }

      if (checkpointPhase === "tool_committed") {
        await persistCheckpoint();
      }

      let toolCall: AgentModelToolUseBlock | undefined;
      const queuedToolUse = queuedToolUses.shift();

      if (queuedToolUse) {
        toolCall = queuedToolUse;
      } else {
        const currentModelStep = totalModelSteps;
        runModelSteps += 1;
        totalModelSteps += 1;
        const shouldUseStream = options.onStreamChunk !== undefined;
        const inboxContent = await drainLeadInboxForModel();
        const promptPayload = {
          request: options.request,
          conversation: options.messageHistory ?? [],
          transcript,
        };

        const notifications = backgroundTasks.collect();
        const userContent = [
          notifications.length > 0 ? formatBackgroundNotifications(notifications) : "",
          ...pendingUserContent.splice(0),
          inboxContent ?? "",
        ].filter((part) => part.trim()).join("\n\n");
        flushUserTurn(userContent || undefined);
        checkpointPhase = "before_model";
        activeToolUse = undefined;
        await persistCheckpoint();

        const modelResult = await callModelWithRecovery({
          gateway: this.gateway,
          systemPrompt,
          promptPayload,
          model: options.model,
          workspaceRoot: options.runtimeRoot,
          threadId: options.threadId,
          signal: options.signal,
          tools: toolSchemas,
          messages: ensureToolResultPairing(modelMessages),
          stream: shouldUseStream
            ? {
                onChunk: (chunk) => {
                  if (chunk.type === "text_delta" && chunk.text) {
                    options.onStreamChunk?.(chunk.text, "message");
                  }
                },
                onThinkingChunk: (chunk) => {
                  options.onThinkingChunk?.(chunk, currentModelStep);
                },
              }
            : undefined,
          onRecovery: (message) => {
            options.onProgress?.({ type: "request-status", message, progress: 0 });
          },
          onContextPrepared: (preparedPayload, notes, preparedMessages) => {
            if (!options.runId || !this.conversationDatabase) return;
            this.conversationDatabase.saveContextSnapshotForRun(
              options.runId,
              {
                payload: preparedPayload,
                messages: preparedMessages ?? ensureToolResultPairing(modelMessages),
              },
              notes,
            );
          },
        });
        if (options.runId && this.conversationDatabase) {
          this.conversationDatabase.appendRuntimeEvent(
            options.runId,
            "model_response",
            {
              modelStep: currentModelStep,
              content: structuredClone(modelResult.content),
              stopReason: modelResult.stopReason,
              model: modelResult.modelUsed,
            },
            "model_only",
          );
        }
        const seenToolCallIds = new Set<string>();
        const toolUses = toolUseBlocksFromContent(modelResult.content).filter((call) => {
          if (!call.id || !call.name || seenToolCallIds.has(call.id)) return false;
          seenToolCallIds.add(call.id);
          return true;
        });
        if (toolUses.length > 0) {
          queuedToolUses.push(...toolUses);
          modelMessages.push({
            role: "assistant",
            content: modelResult.content,
          });
          checkpointPhase = "model_committed";
          await persistCheckpoint();
          continue;
        } else {
          const responseText = textFromContentBlocks(modelResult.content);
          modelMessages.push({ role: "assistant", content: modelResult.content });
          if (options.requiredOutcome === "command_proposal") {
            const guidance =
              "This is an unresolved presentation action. Do not narrate future work. "
              + "Call AskUser if information is still missing, otherwise continue tools and finish with SubmitCommands.";
            transcript.push({ role: "assistant", content: responseText, error: guidance });
            appendUserTurn({ text: guidance });
            continue;
          }

          if (await drainBackgroundForModel(
            "Background tasks have completed. Use these results before giving the final response.",
          )) continue;

          const finalInboxContent = await drainLeadInboxForModel();
          if (finalInboxContent) {
            appendUserTurn({ text: finalInboxContent });
            continue;
          }

          if (options.runId && this.conversationDatabase) {
            this.conversationDatabase.appendRuntimeEvent(
              options.runId,
              "assistant_completed",
              { content: responseText },
            );
          }
          return finish({ type: "message", content: responseText });
        }
      }

      activeToolUse = structuredClone(toolCall);
      if (options.runId && this.conversationDatabase) {
        this.conversationDatabase.appendRuntimeEvent(
          options.runId,
          "tool_call",
          {
            toolUseId: toolCall.id,
            toolName: toolCall.name,
            input: structuredClone(toolCall.input),
            parseError: toolCall.parseError,
          },
          "model_only",
        );
      }
      checkpointPhase = "tool_running";
      await persistCheckpoint();

      const recordToolResult = (
        text: string,
        isError = false,
        images?: Array<{ mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string }>,
      ): void => {
        if (!toolCall) return;
        const result: AgentModelToolResultBlock = {
          type: "tool_result",
          toolUseId: toolCall.id,
          content: [
            { type: "text", text },
            ...(images ?? []).map((image) => ({ type: "image" as const, ...image })),
          ],
          ...(isError ? { isError: true } : {}),
        };
        if (options.runId && this.conversationDatabase) {
          this.conversationDatabase.appendRuntimeEvent(
            options.runId,
            "tool_result",
            {
              toolUseId: toolCall.id,
              toolName: toolCall.name,
              isError,
              content: structuredClone(result.content),
            },
            "model_only",
          );
        }
        const existingIndex = pendingToolResults.current.findIndex(
          (item) => item.toolUseId === toolCall?.id,
        );
        if (existingIndex >= 0) pendingToolResults.current[existingIndex] = result;
        else pendingToolResults.current.push(result);
        activeToolUse = undefined;
        checkpointPhase = "tool_committed";
      };

      if (toolCall.parseError) {
        options.onProgress?.({
          type: "tool-validation-failed",
          toolName: toolCall.name,
          message: `工具 ${toolCall.name} 参数 JSON 解析失败`,
          error: toolCall.parseError,
        });
        transcript.push({
          role: "tool",
          kind: "tool_result",
          toolUseId: toolCall.id,
          toolName: toolCall.name,
          error: toolCall.parseError,
        });
        recordToolResult(toolCall.parseError, true);
        continue;
      }

      const tool = this.registry.get(toolCall.name);
      if (!tool || tool.category !== "core" || tool.loadPolicy !== "core") {
        options.onProgress?.({
          type: "tool-validation-failed",
          toolName: toolCall.name,
          message: `工具 ${toolCall.name} 无法直接调用`,
          error: "Only registered Core Tools can be called directly.",
        });
        transcript.push({
          role: "tool",
          toolName: toolCall.name,
          error: "Only registered Core Tools can be called directly.",
        });
        recordToolResult("Only registered Core Tools can be called directly.", true);
        continue;
      }

      const args = parseDefinedToolInput(tool, toolCall.input);
      if (args.repairs.length > 0 && options.runId && this.conversationDatabase) {
        this.conversationDatabase.appendRuntimeEvent(
          options.runId,
          "workflow_progress",
          {
            type: "tool-input-repaired",
            toolName: tool.name,
            toolUseId: toolCall.id,
            repairs: args.repairs,
          },
          "internal",
        );
      }
      if (!args.success) {
        const failures = (validationFailuresByTool.get(tool.name) ?? 0) + 1;
        validationFailuresByTool.set(tool.name, failures);
        const correction = [
          `Tool ${tool.name} input validation failed. Correct the arguments and retry the tool call.`,
          "Pass nested objects and arrays directly; do not JSON.stringify them.",
          args.error.message,
        ].join("\n");
        if (failures <= 2) {
          options.onProgress?.({
            type: "request-status",
            message: `正在自动修正工具 ${tool.name} 的参数…`,
            progress: 0,
          });
        } else {
          options.onProgress?.({
            type: "tool-validation-failed",
            toolName: tool.name,
            message: `工具 ${tool.name} 参数连续校验失败`,
            error: args.error.message,
          });
        }
        transcript.push({ role: "tool", toolName: tool.name, error: correction });
        recordToolResult(correction, true);
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
          + "mark every step executionTarget=teammate or lead. Leave teammate steps pending for the "
          + "autonomous worker; only claim lead steps, and review submitted teammate work before completion.";
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
          return finish({ type: "message", content: preToolStop.reason });
        }

        if (
          (tool.name === "SubmitCommands" || tool.name === "AskUser")
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
          shouldRunBackground(tool.name, args.data as Record<string, unknown>)
        ) {
          const label = describeBackgroundTask(tool.name, args.data as Record<string, unknown>);
          let bgId = "";
          bgId = backgroundTasks.start({
            toolName: tool.name,
            label,
            run: async () => {
              try {
                const output = validateToolOutput(
                  tool,
                  await tool.execute(args.data, context),
                );
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
                const modelContent = tool.mapResultToModelContent
                  ? await tool.mapResultToModelContent(output, context)
                  : undefined;
                const prepared = await prepareToolResultData({
                  data: output,
                  modelContent,
                  workspaceRoot: options.runtimeRoot,
                  threadId: options.threadId,
                  toolUseId: toolCall.id,
                  toolName: tool.name,
                });
                return prepared.modelContent;
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

        const result = validateToolOutput(
          tool,
          await tool.execute(args.data, context),
        );

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

        const commandProposalResult = agentCommandProposalResultSchema.safeParse(result);
        if (
          !commandProposalResult.success
          && result
          && typeof result === "object"
          && !Array.isArray(result)
          && (result as { type?: unknown }).type === "command_proposal"
        ) {
          throw new Error(
            `${tool.name} returned an invalid command proposal: ${commandProposalResult.error.message}`,
          );
        }
        const commandProposal = commandProposalResult.success
          ? commandProposalResult.data
          : undefined;

        if (commandProposal) {
          if (
            shouldOfferRenderFeedback(context.promptStage, commandProposal.commands, renderFeedbackUsed)
          ) {
            renderFeedbackUsed = true;
            options.onProgress?.({
              type: "render-feedback",
              message: "正在生成排版视觉预览…",
              progress: 0,
            });

            const feedback = await buildRenderFeedback({
              presentation: context.presentation,
              commands: commandProposal.commands,
              proposalSummary: commandProposal.summary,
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
              result: commandProposal,
              renderFeedback: feedback,
            });

            recordToolResult(feedbackMessage, false, feedbackImages);
            continue;
          }

          return finish(commandProposal);
        }

        if (tool.name === "AskUser") {
          const askUser = agentAskUserResultSchema.parse(result);
          recordToolResult(askUser.content);
          return finish(askUser);
        }

        if (tool.name === "SubmitCommands") {
          throw new Error("SubmitCommands must return a command proposal result.");
        }

        const modelContent = tool.mapResultToModelContent
          ? await tool.mapResultToModelContent(result, context)
          : undefined;
        const prepared = await prepareToolResultData({
          data: result,
          modelContent,
          workspaceRoot: options.runtimeRoot,
          threadId: options.threadId,
          toolUseId: toolCall.id,
          toolName: tool.name,
        });
        transcript.push({
          role: "tool",
          toolName: tool.name,
          result: prepared.data,
          toolUseId: toolCall.id,
          ...(prepared.truncated
            ? {
                modelResult: {
                  truncated: true,
                  originalChars: prepared.originalChars,
                  persistedPath: prepared.persistedPath,
                  persistenceError: prepared.persistenceError,
                },
              }
            : {}),
        });
        recordToolResult(prepared.modelContent);
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
      type: "message",
      content: buildMainStepLimitMessage(stepLimits),
    }, "step_limit");
    } finally {
      if (taskStore) {
        const released = await taskStore.unassignInProgressByOwner(taskGraphOwner);
        if (released.length > 0) {
          const plan = await taskStore.getPlanMeta();
          const tasks = filterTasksByPlan(
            await taskStore.listTasks(),
            plan?.planId,
          );
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
