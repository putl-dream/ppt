import type {AgentModelGateway} from "../gateway";
import type {ToolContext, ToolDiscoverySession} from "../tools/tool-definition";
import {ToolRegistry} from "../tools/tool-registry";
import {buildSystemPromptContext, clearSystemPromptCache, getSystemPrompt} from "./system-prompt";
import {
    type AgentRuntimeOptions,
    type AgentRuntimeResult,
} from "./runtime-types";
import {ensureDefaultHooks} from "./default-hooks";
import {triggerHooks} from "./hook-registry";
import type {PostToolUseBlock, StopBlock, UserPromptSubmitBlock} from "./hook-blocks";
import type {SkillRegistry} from "../skills/loadSkillsDir";
import {createEmptySkillRegistry} from "../skills/loadSkillsDir";
import type {SkillSession} from "../skills/skill-types";
import {buildMainStepLimitMessage, getEffectiveMainMaxSteps, resolveAgentStepLimits,} from "@shared/agent-step-limits";
import {filterTasksByPlan, isTaskPlanActive} from "@shared/agent-task-graph";
import {callModelWithRecovery} from "./model-call-recovery";
import {createTaskStore} from "../task/task-store";
import {toToolSchemas} from "../tools/tool-schema";
import type {AgentModelMessage, AgentModelToolResultBlock, AgentModelToolUseBlock,} from "../gateway/types";
import {ensureToolResultPairing} from "../gateway/message-pairing";
import {textFromContentBlocks, toolUseBlocksFromContent} from "../gateway/content-blocks";
import type {TeammateProgressEvent} from "@shared/teammate-progress";
import {
    BackgroundTaskManager,
    describeBackgroundTask,
    formatBackgroundNotifications,
} from "./background-task-manager";
import {
    type DurableRunCheckpoint,
    type DurableRunPhase,
    type DurableRunStatus,
    DurableRunStore,
} from "../persistence/durable-run-store";
import {prepareLayoutChoiceTask, reconcileVerifiedContentTasks,} from "./layout-choice-orchestrator";
import type {ConversationDatabase} from "../../conversation-database";
import {ensureAutonomousTaskWorker} from "../tools/core/task-graph-tools";
import {AgentSession} from "./agent-session";
import {CheckpointCoordinator} from "./checkpoint-coordinator";
import {isRuntimeCancellation, rethrowIfRuntimeCancellation} from "./runtime-cancellation";
import {ToolExecutionEngine} from "./tool-execution-engine";
import {ToolPreflight} from "./tool-preflight";
import {TurnInputAssembler} from "./turn-input-assembler";
import {LeadInboxInputSource} from "./lead-inbox-input-source";
import {PresentationCompletionPolicy} from "./presentation-completion-policy";
import {AgentEventPorts} from "./agent-event-ports";
import {CheckpointPolicy} from "./checkpoint-policy";

/** Derive a display message for teammate progress events lacking one. */
function teammateProgressMessage(event: TeammateProgressEvent): string {
    switch (event.type) {
        case "teammate-assignment-started":
            return `${event.teammateName} 开始处理：${event.description}`;
        case "teammate-thinking-chunk":
            return event.chunk;
        case "teammate-tool-started":
        case "teammate-tool-finished":
            return event.message;
        case "teammate-assignment-finished":
            return event.message ?? `${event.teammateName} 已结束当前任务。`;
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
    // Read-only research is also valid for simple Q&A in the discover stage.
    // In particular, a user may paste a URL and ask for an evaluation without
    // requesting a PPT workflow. Requiring a TaskGraph before WebSearch creates
    // a dead loop: the model keeps requesting search while the runtime keeps
    // rejecting it as "plan first".
    if (
        input.toolName === "AskUser"
        || input.toolName === "WebSearch"
        || input.toolName.startsWith("TaskGraph")
    ) return false;

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
    ) {
    }

    /**
     * 运行一次模型驱动的工具循环：准备提示与恢复点，调用模型，串行执行工具，
     * 并将最终结果归一为普通消息、用户追问或待提交的结构化命令提案。
     * 本方法不直接修改真实 Presentation。
     *
     * 运行主线：恢复 checkpoint → 准备上下文 → 汇总本轮输入 → 调用模型 →
     * 分流文本或工具调用 → 提交工具事实 → 等待补充消息 → 持久化终态 → 清理资源。
     */
    async run(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
        ensureDefaultHooks();

        // 主线 1/8：建立本次运行的取消信号和恢复入口。后续模型、工具与后台任务
        // 共用内部信号，确保用户取消能够沿整条调用链传播。
        const runtimeAbortController = new AbortController();
        const forwardAbort = (): void => runtimeAbortController.abort(options.signal?.reason);
        if (options.signal?.aborted) forwardAbort();
        else options.signal?.addEventListener("abort", forwardAbort, {once: true});
        const rethrowIfCancelled = (error: unknown): void => {
            rethrowIfRuntimeCancellation(error, runtimeAbortController.signal, options.signal);
        };

        const durableRunStore = this.conversationDatabase
            ? new DurableRunStore(this.conversationDatabase)
            : options.workspaceRoot
                ? new DurableRunStore(options.workspaceRoot)
                : undefined;
        const effectiveRunId = options.runId ?? crypto.randomUUID();
        const openedCheckpoint = durableRunStore
            ? await durableRunStore.openLease({
                threadId: options.threadId,
                runId: effectiveRunId,
                resume: options.resumeThread === true,
            })
            : undefined;
        if (openedCheckpoint?.type === "lease_busy") {
            throw new Error(
                `Agent thread ${options.threadId} is already owned by active run ${openedCheckpoint.activeRunId}.`,
            );
        }
        const recovered = openedCheckpoint?.type === "opened"
            ? openedCheckpoint.checkpoint
            : undefined;
        const checkpointCreatedAt = recovered?.createdAt ?? new Date().toISOString();
        const checkpoints = new CheckpointCoordinator(
            durableRunStore,
            openedCheckpoint?.type === "opened" ? openedCheckpoint.lease : undefined,
            openedCheckpoint?.type === "opened" ? openedCheckpoint.currentRevision : 0,
        );
        let detachBackgroundCheckpoint = (): void => undefined;

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
        // Transcript exists before preparation so observational adapter failures during
        // short-circuit preparation can still be diagnosed without becoming control flow.
        const transcript: Array<Record<string, unknown>> = recovered
            ? [...structuredClone(recovered.transcript), {role: "user", content: options.request}]
            : [{role: "user", content: options.request}];
        const eventPorts = new AgentEventPorts({
            threadId: options.threadId,
            runId: effectiveRunId,
            onProgress: options.onProgress,
            conversationDatabase: this.conversationDatabase,
            transcript,
        });

        // UI 回调只用于观测；渲染进程监听器即使同步抛错，也不能中断核心 Runtime。
        const emitProgress = eventPorts.renderer.bind(eventPorts);

        // 主线 2/8：准备只属于本次运行的提示词、工具上下文和任务图环境。
        // 这一步只组装执行条件，不进入模型循环，也不产生工具副作用。
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
            const {text: systemPrompt} = getSystemPrompt(promptContext, options.threadId);

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
                signal: runtimeAbortController.signal,
                requestToolApproval: options.requestToolApproval,
                notifyTaskGraphUpdated: ({tasks, goal}) => {
                    emitProgress({
                        type: "task-graph-updated",
                        message: "任务图已更新",
                        tasks,
                        goal,
                    });
                },
                onTeammateProgress: options.onProgress
                    ? (event) => emitProgress({
                        ...event,
                        message: teammateProgressMessage(event),
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
                emitProgress({
                    type: "workflow-progress",
                    message: prepared.message,
                    progress: 20,
                });
                return {type: "message", content: prepared.message};
            }
            if (taskStore && options.workspaceRoot) {
                await reconcileVerifiedContentTasks({
                    workspaceRoot: options.workspaceRoot,
                    taskStore,
                });
                ensureAutonomousTaskWorker(context, await taskStore.listTasks());
            }
            const appendRuntimeEventSafely = eventPorts.audit.bind(eventPorts);

            const runPostToolUseHook = async (block: PostToolUseBlock): Promise<string[]> => {
                try {
                    // PostToolUse 仅用于观测；Hook 失败不能推翻 execute() 已确定的执行事实。
                    await triggerHooks("PostToolUse", block);
                    return [];
                } catch (error) {
                    rethrowIfCancelled(error);
                    const message = error instanceof Error ? error.message : String(error);
                    transcript.push({
                        role: "system",
                        kind: "hook_error",
                        hook: "PostToolUse",
                        toolName: block.toolName,
                        content: message,
                    });
                    emitProgress({
                        type: "workflow-warning",
                        message: `工具 ${block.toolName} 已执行，但 PostToolUse Hook 失败：${message}`,
                        toolName: block.toolName,
                    });
                    return [message];
                }
            };

            // 主线 3/8：把 checkpoint 还原为可继续推进的内存状态。
            // 恢复的队列、待提交工具结果和后台任务会接回同一条模型循环，而不是另开流程。
            const toolSchemas = toToolSchemas(coreTools);
            const modelMessages: AgentModelMessage[] = recovered
                ? structuredClone(recovered.modelMessages)
                : [
                    ...(options.messageHistory ?? []).map((entry) => ({
                        role: entry.role,
                        content: [{type: "text" as const, text: entry.content}],
                    })),
                    {role: "user", content: [{type: "text", text: options.request}]},
                ];
            const session = new AgentSession({
                transcript,
                modelMessages,
                queuedToolUses: structuredClone(recovered?.queuedToolUses ?? []),
                pendingToolResults: structuredClone(recovered?.pendingToolResults ?? []),
                pendingUserContent: [...(recovered?.pendingUserContent ?? [])],
                processedInboxMessageIds: recovered?.processedInboxMessageIds,
                renderFeedbackUsed: recovered?.renderFeedbackUsed,
                activeToolUse: recovered?.activeToolUse
                    ? structuredClone(recovered.activeToolUse)
                    : undefined,
                phase: recovered?.phase,
                totalModelSteps: recovered?.modelStep,
            });
            const queuedToolUses = session.queuedToolUses;
            const pendingUserContent = session.pendingUserContent;
            const processedInboxMessageIds = session.processedInboxMessageIds;
            const validationFailuresByTool = session.validationFailuresByTool;
            const backgroundTasks = new BackgroundTaskManager({
                runId: effectiveRunId,
                recovered: recovered?.backgroundTasks,
            });
            const toolExecutionEngine = new ToolExecutionEngine();
            const toolPreflight = new ToolPreflight(this.registry);
            const presentationCompletionPolicy = new PresentationCompletionPolicy();
            const checkpointPolicy = new CheckpointPolicy();

            // checkpoint 停在 tool_running 时，进程无法判断工具是否已经产生副作用。
            // 因此只合成“不确定”结果交给模型核对，绝不自动重放该工具。
            if (recovered?.phase === "tool_running" && session.activeToolUse) {
                const activeToolUse = session.activeToolUse;
                const alreadyRecorded = session.pendingToolResults.some(
                    (item) => item.toolUseId === activeToolUse.id,
                );
                if (!alreadyRecorded) {
                    session.replacePendingToolResults([...session.pendingToolResults, {
                        type: "tool_result",
                        toolUseId: activeToolUse.id,
                        isError: true,
                        content: [{
                            type: "text",
                            text: "The application restarted while this tool was running. Its side effects are uncertain. Inspect durable workspace artifacts and task state before deciding whether to retry; do not assume either success or failure.",
                        }],
                    }]);
                }
                transcript.push({
                    role: "system",
                    kind: "recovery",
                    toolUseId: activeToolUse.id,
                    toolName: activeToolUse.name,
                    content: "Recovered an interrupted tool boundary; side effects require reconciliation.",
                });
                session.clearActiveTool();
                session.setPhase("tool_committed");
            }

            if (
                recovered
                && recovered.backgroundTasks === undefined
                && (recovered.status === "running" || recovered.status === "interrupted" || recovered.status === "failed")
            ) {
                // 兼容尚未把后台任务作为正式持久化字段的旧版 version-1 checkpoint。
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
                if (session.phase === "model_committed" && queuedToolUses.length > 0) {
                    pendingUserContent.push(continuationText);
                } else if (session.pendingToolResults.length > 0) {
                    modelMessages.push({
                        role: "user",
                        content: [
                            ...session.pendingToolResults,
                            {type: "text", text: continuationText},
                        ],
                    });
                    session.replacePendingToolResults([]);
                } else {
                    const last = modelMessages.at(-1);
                    if (last?.role === "user" && !last.content.some((block) => block.type === "tool_result")) {
                        last.content.push({type: "text", text: continuationText});
                    } else {
                        modelMessages.push({
                            role: "user",
                            content: [{type: "text", text: continuationText}],
                        });
                    }
                }
            }

            // 主线 4/8：统一生成不可变 checkpoint snapshot，具体串行写入、
            // terminal fence 和失败终态降级由 CheckpointCoordinator 负责。
            const createCheckpoint = (input?: {
                status?: DurableRunStatus;
                phase?: DurableRunPhase;
                result?: AgentRuntimeResult;
                error?: string;
            }): DurableRunCheckpoint => {
                const now = new Date().toISOString();
                return {
                    version: 1,
                    threadId: options.threadId,
                    runId: effectiveRunId,
                    status: input?.status ?? session.terminalState?.status ?? "running",
                    phase: input?.phase ?? (session.terminalState ? "finished" : session.phase),
                    request: options.request,
                    model: options.model,
                    executionStrategy: options.executionStrategy,
                    baseRevision: options.presentationSnapshot.revision,
                    modelStep: session.totalModelSteps,
                    modelMessages: structuredClone(modelMessages),
                    transcript: structuredClone(transcript),
                    queuedToolUses: structuredClone(queuedToolUses),
                    pendingToolResults: structuredClone(session.pendingToolResults),
                    pendingUserContent: [...pendingUserContent],
                    discoveredToolNames: [...discoverySession.discoveredToolNames].sort(),
                    loadedSkillNames: [...skillSession.loadedSkillNames].sort(),
                    renderFeedbackUsed: session.renderFeedbackUsed,
                    activeToolUse: session.activeToolUse ? structuredClone(session.activeToolUse) : undefined,
                    backgroundTasks: backgroundTasks.snapshot(),
                    processedInboxMessageIds: [...processedInboxMessageIds].sort(),
                    result: input?.result ?? session.terminalState?.result,
                    error: input?.error ?? session.terminalState?.error,
                    createdAt: checkpointCreatedAt,
                    updatedAt: now,
                };
            };
            const persistCheckpoint = async (input?: Parameters<typeof createCheckpoint>[0]): Promise<void> => {
                await checkpoints.commit(createCheckpoint(input));
            };
            const applyTransition = (transition: Parameters<AgentSession["apply"]>[0]) => {
                session.apply(transition);
                return checkpointPolicy.afterTransition(transition);
            };

            backgroundTasks.setOnStateChange(async () => {
                try {
                    await persistCheckpoint();
                } catch (error) {
                    transcript.push({
                        role: "system",
                        kind: "background_checkpoint_error",
                        content: error instanceof Error ? error.message : String(error),
                    });
                }
            });
            detachBackgroundCheckpoint = () => backgroundTasks.setOnStateChange(undefined);

            const turnInput = new TurnInputAssembler(modelMessages);
            const appendUserTurn = (input: {
                text?: string;
                toolResults?: AgentModelToolResultBlock[];
            }): void => turnInput.append(input);

            const flushUserTurn = (text?: string): void => {
                const toolResults = session.pendingToolResults.length
                    ? [...session.pendingToolResults]
                    : undefined;
                appendUserTurn({text, toolResults});
                session.replacePendingToolResults([]);
            };

            // Inbox 子线遵循 claim → 去重 → 写入 Transcript/checkpoint → ack。
            // 崩溃时允许重复领取，但已提交的消息 ID 会阻止模型重复消费。
            const leadInbox = new LeadInboxInputSource({
                messageBus: options.messageBus,
                teammateManager: options.teammateManager,
                requestToolApproval: options.requestToolApproval,
                processedMessageIds: processedInboxMessageIds,
                transcript,
                commit: persistCheckpoint,
            });
            const drainLeadInboxForModel = (): Promise<string | undefined> => leadInbox.drain();

            // 后台任务只在合法的用户轮次注入通知；若当前仍有成批工具结果待回传，
            // 通知先暂存，避免拆断 assistant 工具调用与紧随其后的 tool_result。
            const drainBackgroundForModel = async (instruction: string): Promise<boolean> => {
                if (!backgroundTasks.hasRunning() && !backgroundTasks.hasPendingNotifications()) return false;
                const notifications = await backgroundTasks.drain(runtimeAbortController.signal);
                if (notifications.length === 0) return false;
                const content = `${formatBackgroundNotifications(notifications)}\n\n${instruction}`;
                if (queuedToolUses.length > 0) {
                    // 保持 assistant 工具批次连续：即使后台任务提前完成，全部 tool_result
                    // 仍必须出现在该 assistant 消息之后的第一个用户轮次中。
                    pendingUserContent.push(content);
                } else {
                    flushUserTurn(content);
                }
                return true;
            };

            const runStopHookSafely = async (block: StopBlock): Promise<void> => {
                try {
                    // Stop 仅用于观测。先提交终态再运行 Hook，
                    // 防止日志或插件故障抹掉已经确定的结果。
                    await triggerHooks("Stop", block);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    transcript.push({role: "system", kind: "hook_error", hook: "Stop", content: message});
                    appendRuntimeEventSafely("workflow_progress", {
                        type: "stop-hook-error",
                        message,
                    }, "internal");
                }
            };

            // 所有成功出口统一经过 finish：先落盘权威终态，再运行观测型 Stop Hook，
            // 确保 Hook、日志或 UI 故障不会把已确定的结果改写成失败。
            const finish = async (
                result: AgentRuntimeResult,
                requestedReason?: StopBlock["reason"],
            ): Promise<AgentRuntimeResult> => {
                const status: DurableRunStatus = result.type === "ask_user"
                    ? "waiting_user"
                    : result.type === "command_proposal"
                        ? "proposal_ready"
                        : "completed";
                const reason: StopBlock["reason"] = requestedReason
                    ?? (result.type === "ask_user"
                        ? "waiting_user"
                        : result.type === "command_proposal"
                            ? "proposal_ready"
                            : "completed");
                const checkpointDecision = applyTransition({type: "run_terminal", status, result});
                if (checkpointDecision !== "terminal") {
                    throw new Error("CheckpointPolicy rejected a Runtime terminal transition.");
                }
                await checkpoints.commitTerminal(createCheckpoint({status, phase: "finished", result}));
                session.sealTerminal();
                await runStopHookSafely({
                    event: "Stop",
                    threadId: options.threadId,
                    scope: "main",
                    result,
                    reason,
                } satisfies StopBlock);
                return result;
            };

            // 主线 5/8：进入模型循环。每轮优先处理已恢复的工具队列；只有队列为空时
            // 才汇总 Inbox、后台通知和待回传结果，并发起新的模型请求。
            try {
                const promptBlock: UserPromptSubmitBlock = {
                    event: "UserPromptSubmit",
                    threadId: options.threadId,
                    request: options.request,
                    messageHistory: options.messageHistory,
                };
                const promptStop = await triggerHooks("UserPromptSubmit", promptBlock);
                if (promptStop) {
                    return await finish({type: "message", content: promptStop.reason});
                }

                while (session.runModelSteps < maxSteps || queuedToolUses.length > 0) {
                    if (runtimeAbortController.signal.aborted) {
                        throw new Error("Run aborted by user.");
                    }

                    if (session.phase === "tool_committed") {
                        await persistCheckpoint();
                    }

                    let toolCall: AgentModelToolUseBlock | undefined;
                    const queuedToolUse = queuedToolUses.shift();

                    if (queuedToolUse) {
                        toolCall = queuedToolUse;
                    } else {
                        const currentModelStep = session.totalModelSteps;
                        const checkpointDecision = applyTransition({type: "model_input_prepared"});
                        const shouldUseStream = options.onStreamChunk !== undefined;
                        const inboxContent = await drainLeadInboxForModel();
                        const promptPayload = {
                            request: options.request,
                            conversation: options.messageHistory ?? [],
                            transcript,
                        };

                        // 模型调用前先封口本轮输入：后台通知、延迟内容和 Inbox 消息
                        // 合并为一个用户轮次，随后保存 before_model checkpoint。
                        const notifications = backgroundTasks.collect();
                        const userContent = [
                            notifications.length > 0 ? formatBackgroundNotifications(notifications) : "",
                            ...pendingUserContent.splice(0),
                            inboxContent ?? "",
                        ].filter((part) => part.trim()).join("\n\n");
                        flushUserTurn(userContent || undefined);
                        if (checkpointDecision === "commit") await persistCheckpoint();

                        const modelResult = await callModelWithRecovery({
                            gateway: this.gateway,
                            systemPrompt,
                            promptPayload,
                            model: options.model,
                            workspaceRoot: options.runtimeRoot,
                            threadId: options.threadId,
                            signal: runtimeAbortController.signal,
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
                                emitProgress({type: "request-status", message, progress: 0});
                            },
                            onContextPrepared: (preparedPayload, notes, preparedMessages) => {
                                if (!this.conversationDatabase) return;
                                this.conversationDatabase.saveContextSnapshotForRun(
                                    effectiveRunId,
                                    {
                                        payload: preparedPayload,
                                        messages: preparedMessages ?? ensureToolResultPairing(modelMessages),
                                    },
                                    notes,
                                );
                            },
                        });
                        appendRuntimeEventSafely("model_response", {
                            modelStep: currentModelStep,
                            content: structuredClone(modelResult.content),
                            stopReason: modelResult.stopReason,
                            model: modelResult.modelUsed,
                        }, "model_only");
                        const seenToolCallIds = new Set<string>();
                        const toolUses = toolUseBlocksFromContent(modelResult.content).filter((call) => {
                            if (!call.id || !call.name || seenToolCallIds.has(call.id)) return false;
                            seenToolCallIds.add(call.id);
                            return true;
                        });
                        // 模型输出在这里分叉：有工具调用就完整保存 assistant 批次并入队；
                        // 只有纯文本输出才有资格进入最终回答检查。
                        if (toolUses.length > 0) {
                            const responseCheckpointDecision = applyTransition({
                                type: "model_response_received",
                                content: modelResult.content,
                                toolUses,
                            });
                            if (responseCheckpointDecision === "commit") await persistCheckpoint();
                            continue;
                        } else {
                            const responseText = textFromContentBlocks(modelResult.content);
                            applyTransition({
                                type: "model_response_received",
                                content: modelResult.content,
                                toolUses: [],
                            });
                            if (options.requiredOutcome === "command_proposal") {
                                const guidance =
                                    "This is an unresolved presentation action. Do not narrate future work. "
                                    + "Call AskUser if information is still missing, otherwise continue tools and finish with SubmitCommands.";
                                transcript.push({role: "assistant", content: responseText, error: guidance});
                                appendUserTurn({text: guidance});
                                continue;
                            }

                            if (await drainBackgroundForModel(
                                "Background tasks have completed. Use these results before giving the final response.",
                            )) continue;

                            const finalInboxContent = await drainLeadInboxForModel();
                            if (finalInboxContent) {
                                appendUserTurn({text: finalInboxContent});
                                continue;
                            }

                            appendRuntimeEventSafely("assistant_completed", {content: responseText});
                            return await finish({type: "message", content: responseText});
                        }
                    }

                    // 主线 6/8：进入单个工具事务。先把 activeToolUse 以 tool_running 落盘，
                    // 再做解析、权限判断和 execute，崩溃恢复时才能识别副作用不确定边界。
                    const toolClaimCheckpointDecision = applyTransition({type: "tool_claimed", toolUse: toolCall});
                    appendRuntimeEventSafely("tool_call", {
                        toolUseId: toolCall.id,
                        toolName: toolCall.name,
                        input: structuredClone(toolCall.input),
                        parseError: toolCall.parseError,
                    }, "model_only");
                    if (toolClaimCheckpointDecision === "commit") await persistCheckpoint();

                    const recordToolResultBlock = (result: AgentModelToolResultBlock): void => {
                        const decision = applyTransition({type: "tool_processed", result});
                        if (decision !== "commit_before_next") {
                            throw new Error("CheckpointPolicy rejected a normal tool result transition.");
                        }
                        // 先把权威内存状态推进到 tool_committed；循环顶部会在下一步前落盘。
                        // Runtime Event 只做审计投影，写入失败不影响工具结果。
                        appendRuntimeEventSafely("tool_result", {
                            toolUseId: toolCall.id,
                            toolName: toolCall.name,
                            isError: result.isError === true,
                            content: structuredClone(result.content),
                        }, "model_only");
                    };
                    const recordToolResult = (
                        text: string,
                        isError = false,
                        images?: Array<{
                            mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
                            data: string
                        }>,
                    ): void => {
                        if (!toolCall) return;
                        recordToolResultBlock({
                            type: "tool_result",
                            toolUseId: toolCall.id,
                            content: [
                                {type: "text", text},
                                ...(images ?? []).map((image) => ({type: "image" as const, ...image})),
                            ],
                            ...(isError ? {isError: true} : {}),
                        });
                    };

                    const preflight = await toolPreflight.prepare({
                        toolCall,
                        context,
                        workspaceRoot: options.workspaceRoot,
                        threadId: options.threadId,
                        requestToolApproval: options.requestToolApproval,
                        signal: runtimeAbortController.signal,
                        policyGuidance: async (toolName) => {
                            if (!await shouldRequireDiscoverTaskPlan({
                                stage: context.promptStage,
                                toolName,
                                taskStore,
                            })) return undefined;
                            return "Full or multi-step PPT creation in the discover stage must start with "
                                + "TaskGraphCreatePlan(sequential=true, 3-5 concrete steps) before LoadSkill, "
                                + "ReadPresentationSnapshot, or other execution tools. Create the visible task plan first, "
                                + "mark every step executionTarget=teammate or lead. Leave teammate steps pending for the "
                                + "autonomous worker; only claim lead steps, and review submitted teammate work before completion.";
                        },
                    });
                    if (preflight.repairs.length > 0) {
                        appendRuntimeEventSafely("workflow_progress", {
                            type: "tool-input-repaired",
                            toolName: toolCall.name,
                            toolUseId: toolCall.id,
                            repairs: preflight.repairs,
                        }, "internal");
                    }

                    if (preflight.type === "immediate_result") {
                        const outcomeText = preflight.outcome.modelResult.content
                            .filter((block) => block.type === "text")
                            .map((block) => block.text)
                            .join("\n");
                        if (preflight.kind === "validation_error") {
                            const failures = (validationFailuresByTool.get(toolCall.name) ?? 0) + 1;
                            validationFailuresByTool.set(toolCall.name, failures);
                            if (failures <= 2) {
                                emitProgress({
                                    type: "request-status",
                                    message: `正在自动修正工具 ${toolCall.name} 的参数…`,
                                    progress: 0,
                                });
                            } else {
                                emitProgress({
                                    type: "tool-validation-failed",
                                    toolName: toolCall.name,
                                    message: `工具 ${toolCall.name} 参数连续校验失败`,
                                    error: preflight.validationError ?? outcomeText,
                                });
                            }
                        } else if (preflight.kind === "policy_blocked") {
                            emitProgress({
                                type: "workflow-progress",
                                message: "正在先建立可见任务计划...",
                                progress: 0,
                            });
                        } else {
                            emitProgress({
                                type: "tool-validation-failed",
                                toolName: toolCall.name,
                                message: preflight.kind === "parse_error"
                                    ? `工具 ${toolCall.name} 参数 JSON 解析失败`
                                    : preflight.kind === "unavailable"
                                        ? `工具 ${toolCall.name} 无法直接调用`
                                        : `工具 ${toolCall.name} 执行前检查失败`,
                                error: outcomeText,
                            });
                        }
                        transcript.push({
                            role: "tool",
                            toolName: toolCall.name,
                            error: outcomeText,
                            executionStatus: "not_started",
                            sideEffects: "none",
                        });
                        recordToolResultBlock(preflight.outcome.modelResult);
                        continue;
                    }

                    if (preflight.type === "denied") {
                        emitProgress({
                            type: "tool-finished",
                            message: `工具 ${preflight.tool.name} 被拒绝: ${preflight.reason}`,
                            toolName: preflight.tool.name,
                        });
                        transcript.push({
                            role: "tool",
                            toolName: preflight.tool.name,
                            error: preflight.reason,
                            executionStatus: "not_started",
                            sideEffects: "none",
                        });
                        recordToolResultBlock(preflight.modelResult);
                        continue;
                    }
                    if (preflight.type === "hook_stopped") {
                        return await finish({type: "message", content: preflight.reason});
                    }

                    const {tool, args, mode} = preflight.prepared;
                    emitProgress({
                        type: "tool-started",
                        message: `正在调用工具 ${tool.name}...`,
                        toolName: tool.name,
                    });

                    if (
                        presentationCompletionPolicy.isFinishTool(tool.name)
                        && (backgroundTasks.hasRunning() || backgroundTasks.hasPendingNotifications())
                    ) {
                        const guidance =
                            `Paused ${tool.name} because background task results are not yet incorporated. `
                            + "Review the task_notification content, then call the appropriate finish tool again.";
                        transcript.push({
                            role: "tool",
                            toolName: tool.name,
                            result: {pausedForBackgroundTasks: true, guidance},
                        });
                        recordToolResult(guidance);
                        await drainBackgroundForModel(
                            "Background tasks have completed. Reconsider these results before calling a finish tool.",
                        );
                        emitProgress({
                            type: "tool-finished",
                            message: `工具 ${tool.name} 已等待后台任务结果。`,
                            toolName: tool.name,
                        });
                        continue;
                    }

                    // 后台分支立即向模型返回任务占位符，真实结果由 BackgroundTaskManager
                    // 独立持久化并在后续安全轮次注入；前台分支则在当前循环完成全部阶段。
                    if (mode === "background") {
                        const label = describeBackgroundTask(tool.name, args as Record<string, unknown>);
                        let bgId = "";
                        const scheduled = backgroundTasks.prepare({
                            toolName: tool.name,
                            label,
                            toolUseId: toolCall.id,
                            run: async () => {
                                const outcome = await toolExecutionEngine.execute({
                                    tool,
                                    args,
                                    context,
                                    toolCall,
                                    runtimeArtifactRoot: options.runtimeRoot,
                                    threadId: options.threadId,
                                    signal: runtimeAbortController.signal,
                                    runPostToolUseHook,
                                });
                                const content = outcome.modelResult.content
                                    .filter((block) => block.type === "text")
                                    .map((block) => block.text)
                                    .join("\n");
                                if (
                                    outcome.executionStatus === "threw"
                                    || outcome.deliveryStatus === "validation_failed"
                                ) {
                                    emitProgress({
                                        type: "tool-finished",
                                        message: `后台任务 ${bgId} 执行失败：${content}`,
                                        toolName: tool.name,
                                    });
                                    throw new Error(content);
                                }
                                emitProgress({
                                    type: "tool-finished",
                                    message: `后台任务 ${bgId} 已完成：${tool.name}`,
                                    toolName: tool.name,
                                });
                                return content;
                            },
                        });
                        bgId = scheduled.bgId;

                        const placeholder =
                            `[Background task ${bgId} started: ${label}] `
                            + "Result will arrive later as task_notification. Continue with independent work.";
                        transcript.push({
                            role: "tool",
                            toolName: tool.name,
                            result: {backgroundTaskId: bgId, status: "running", label},
                        });
                        recordToolResult(placeholder);
                        // 两阶段后台协议：先把 scheduled task 与 tool placeholder 一起
                        // 写入 durable checkpoint，确认成功后才允许真实工具产生副作用。
                        await persistCheckpoint();
                        scheduled.launch();
                        emitProgress({
                            type: "workflow-progress",
                            message: `后台任务 ${bgId} 已启动：${label}`,
                            progress: 0,
                        });
                        continue;
                    }

                    const executionOutcome = await toolExecutionEngine.execute({
                        tool,
                        args,
                        context,
                        toolCall,
                        runtimeArtifactRoot: options.runtimeRoot,
                        threadId: options.threadId,
                        signal: runtimeAbortController.signal,
                        runPostToolUseHook,
                    });
                    const outcomeText = executionOutcome.modelResult.content
                        .filter((block) => block.type === "text")
                        .map((block) => block.text)
                        .join("\n");
                    if (executionOutcome.executionStatus === "threw") {
                        emitProgress({
                            type: "tool-finished",
                            message: `工具 ${tool.name} 执行失败: ${outcomeText}`,
                            toolName: tool.name,
                        });
                        transcript.push({
                            role: "tool",
                            toolName: tool.name,
                            error: outcomeText,
                            sideEffects: executionOutcome.sideEffects,
                        });
                        recordToolResultBlock(executionOutcome.modelResult);
                        continue;
                    }
                    if (executionOutcome.deliveryStatus === "validation_failed") {
                        transcript.push({
                            role: "tool",
                            toolName: tool.name,
                            error: outcomeText,
                            executionStatus: "returned",
                            sideEffects: executionOutcome.sideEffects,
                        });
                        recordToolResultBlock(executionOutcome.modelResult);
                        continue;
                    }

                    const result = executionOutcome.validatedResult;

                    emitProgress({
                        type: "tool-finished",
                        message: `工具 ${tool.name} 执行完成。`,
                        toolName: tool.name,
                    });

                    try {
                        const decision = await presentationCompletionPolicy.interpret({
                            toolName: tool.name,
                            toolUseId: toolCall.id,
                            outcome: executionOutcome,
                            context,
                            promptStage: context.promptStage,
                            renderFeedbackUsed: session.renderFeedbackUsed,
                            emitProgress,
                        });
                        if (decision.type === "terminal") {
                            if (decision.modelResult) recordToolResultBlock(decision.modelResult);
                            return await finish(decision.result);
                        }
                        if (decision.markRenderFeedbackUsed) session.markRenderFeedbackUsed();
                        transcript.push(decision.transcriptEntry);
                        recordToolResultBlock(decision.modelResult);
                    } catch (error) {
                        rethrowIfCancelled(error);
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        const guidance = `Tool ${tool.name} executed successfully, but result post-processing failed: ${errorMessage}. Do not retry blindly; inspect durable artifacts first.`;
                        transcript.push({
                            role: "tool",
                            toolName: tool.name,
                            result,
                            postProcessingError: errorMessage,
                            executionStatus: "returned",
                        });
                        recordToolResult(guidance);
                    }

                }

                // 主线 7/8：模型步数耗尽后收拢后台任务。此处已不能再调用模型，
                // 因而把完成通知直接并入 Transcript 和用户可见结果，避免结果悬空。
                const finalBackgroundNotifications = backgroundTasks.hasRunning()
                    ? await backgroundTasks.drain(runtimeAbortController.signal)
                    : backgroundTasks.collect();
                const finalBackgroundContent = finalBackgroundNotifications.length > 0
                    ? formatBackgroundNotifications(finalBackgroundNotifications)
                    : "";
                if (finalBackgroundContent) {
                    // 此时模型预算已经耗尽；将后台完成结果同时保留到 Transcript 和
                    // 用户可见的终态结果中，避免 drain 后静默丢弃。
                    transcript.push({
                        role: "system",
                        kind: "background_step_limit_results",
                        content: finalBackgroundContent,
                    });
                }

                if (options.requiredOutcome === "command_proposal") {
                    throw new Error(
                        "Agent reached the tool-step limit before resolving the presentation action. "
                        + "The conversation remains active and can be continued."
                        + (finalBackgroundContent ? `\n\n${finalBackgroundContent}` : ""),
                    );
                }

                return await finish({
                    type: "message",
                    content: [buildMainStepLimitMessage(stepLimits), finalBackgroundContent]
                        .filter(Boolean)
                        .join("\n\n"),
                }, "step_limit");
            // 主线 8/8：任意异常或取消都先写入 failed/interrupted 终态，再触发 Stop Hook。
            // 最外层 finally 只负责释放资源，不参与重新判定本次运行的业务结果。
            } catch (error) {
                const aborted = isRuntimeCancellation(
                    error,
                    runtimeAbortController.signal,
                    options.signal,
                );
                runtimeAbortController.abort(error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                session.overrideTerminalCandidate({
                    status: aborted ? "interrupted" : "failed",
                    error: errorMessage,
                });
                try {
                    const terminalSaved = await checkpoints.commitFailureTerminal(createCheckpoint({
                        status: aborted ? "interrupted" : "failed",
                        phase: "finished",
                        error: errorMessage,
                    }));
                    if (!terminalSaved) {
                        throw new Error("Failed to persist the Runtime failure terminal checkpoint.");
                    }
                    session.sealTerminal();
                } catch (checkpointError) {
                    // Checkpoint Store 本身可能就是故障源；保留主错误，并使用独立的
                    // Runtime Event 投影作为尽力而为的降级通道，避免递归依赖同一存储。
                    appendRuntimeEventSafely("workflow_progress", {
                        type: "checkpoint-fallback-error",
                        error: checkpointError instanceof Error ? checkpointError.message : String(checkpointError),
                        primaryError: errorMessage,
                    }, "internal");
                }
                await runStopHookSafely({
                    event: "Stop",
                    threadId: options.threadId,
                    scope: "main",
                    result: errorMessage,
                    reason: aborted ? "aborted" : "failed",
                });
                throw error;
            }
        } finally {
            runtimeAbortController.abort();
            options.signal?.removeEventListener("abort", forwardAbort);
            detachBackgroundCheckpoint();
            try {
                await checkpoints.close();
            } catch (cleanupError) {
                emitProgress({
                    type: "workflow-warning",
                    message: `Checkpoint cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
                });
            }
            try {
                if (taskStore) {
                    const released = await taskStore.unassignInProgressByOwner(taskGraphOwner);
                    if (released.length > 0) {
                        const plan = await taskStore.getPlanMeta();
                        const tasks = filterTasksByPlan(
                            await taskStore.listTasks(),
                            plan?.planId,
                        );
                        emitProgress({
                            type: "task-graph-updated",
                            message: "任务图已更新",
                            tasks,
                            goal: plan?.goal ?? null,
                        });
                    }
                }
            } catch (cleanupError) {
                // 清理采用尽力而为语义：不能替换成功结果，也不能掩盖调用方应看到的主异常。
                emitProgress({
                    type: "workflow-warning",
                    message: `Runtime cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
                });
            }
        }
    }

    clearSession(threadId: string): void {
        this.discoverySessions.delete(threadId);
        this.skillSessions.delete(threadId);
        clearSystemPromptCache(threadId);
    }
}
