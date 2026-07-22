import type {AgentModelGateway} from "../gateway";
import type {ToolContext, ToolDiscoverySession} from "../tools/tool-definition";
import {ToolRegistry} from "../tools/tool-registry";
import {buildSystemPromptContext, clearSystemPromptCache, getSystemPrompt} from "./system-prompt";
import {
    agentAskUserResultSchema,
    agentCommandProposalResultSchema,
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
import {validateToolOutput} from "../tools/tool-validation";
import {parseDefinedToolInput} from "../tools/tool-input";
import {prepareToolResultData} from "./tool-result-data";
import type {TeammateProgressEvent} from "@shared/teammate-progress";
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
import {type AgentMailboxMessage, formatMailboxMessagesForHistory,} from "../teammate/message-bus";
import {
    type DurableRunCheckpoint,
    type DurableRunPhase,
    type DurableRunStatus,
    DurableRunStore,
} from "../persistence/durable-run-store";
import {prepareLayoutChoiceTask, reconcileVerifiedContentTasks,} from "./layout-choice-orchestrator";
import type {ConversationDatabase} from "../../conversation-database";
import {ensureAutonomousTaskWorker} from "../tools/core/task-graph-tools";

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

        // UI 回调只用于观测；渲染进程监听器即使同步抛错，也不能中断核心 Runtime。
        const emitProgress = (event: { type: string; message: string; [key: string]: unknown }): void => {
            try {
                options.onProgress?.(event);
            } catch {
                // UI 投递失败时仍以持久化状态为准。
            }
        };

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
            // Transcript 记录面向恢复与诊断的运行事实；modelMessages 则严格维护
            // 模型协议所需的 assistant/tool_result 配对，两者职责不同但同步推进。
            const transcript: Array<Record<string, unknown>> = recovered
                ? [...structuredClone(recovered.transcript), {role: "user", content: options.request}]
                : [{role: "user", content: options.request}];

            const appendRuntimeEventSafely = (
                kind: Parameters<ConversationDatabase["appendRuntimeEvent"]>[1],
                payload: Record<string, unknown>,
                visibility: Parameters<ConversationDatabase["appendRuntimeEvent"]>[3] = "user_visible",
            ): void => {
                if (!options.runId || !this.conversationDatabase) return;
                try {
                    this.conversationDatabase.appendRuntimeEvent(options.runId, kind, payload, visibility);
                } catch (error) {
                    // Runtime Event 只是审计投影，不是模型或工具事实的提交边界；
                    // 写入失败时将警告保存在可持久化 Transcript 中。
                    transcript.push({
                        role: "system",
                        kind: "runtime_event_error",
                        eventKind: kind,
                        content: error instanceof Error ? error.message : String(error),
                    });
                }
            };

            const runPostToolUseHook = async (block: PostToolUseBlock): Promise<void> => {
                try {
                    // PostToolUse 仅用于观测；Hook 失败不能推翻 execute() 已确定的执行事实。
                    await triggerHooks("PostToolUse", block);
                } catch (error) {
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
                }
            };

            // 主线 3/8：把 checkpoint 还原为可继续推进的内存状态。
            // 恢复的队列、待提交工具结果和后台任务会接回同一条模型循环，而不是另开流程。
            const toolSchemas = toToolSchemas(coreTools);
            const recoveredPendingToolResults = structuredClone(recovered?.pendingToolResults ?? []);
            const modelMessages: AgentModelMessage[] = recovered
                ? structuredClone(recovered.modelMessages)
                : [
                    ...(options.messageHistory ?? []).map((entry) => ({
                        role: entry.role,
                        content: [{type: "text" as const, text: entry.content}],
                    })),
                    {role: "user", content: [{type: "text", text: options.request}]},
                ];
            const pendingToolResults: { current: AgentModelToolResultBlock[] } = {
                current: recoveredPendingToolResults,
            };
            const queuedToolUses: AgentModelToolUseBlock[] = structuredClone(
                recovered?.queuedToolUses ?? [],
            );
            const validationFailuresByTool = new Map<string, number>();
            const pendingUserContent: string[] = [...(recovered?.pendingUserContent ?? [])];
            const processedInboxMessageIds = new Set(recovered?.processedInboxMessageIds ?? []);
            let renderFeedbackUsed = recovered?.renderFeedbackUsed ?? false;
            let activeToolUse = recovered?.activeToolUse
                ? structuredClone(recovered.activeToolUse)
                : undefined;
            let checkpointPhase: DurableRunPhase = recovered?.phase ?? "before_model";
            let totalModelSteps = recovered?.modelStep ?? 0;
            let terminalCheckpoint: {
                status: DurableRunStatus;
                result?: AgentRuntimeResult;
                error?: string;
            } | undefined;
            const backgroundTasks = new BackgroundTaskManager({
                runId: options.runId ?? `${options.threadId}:${crypto.randomUUID()}`,
                recovered: recovered?.backgroundTasks,
            });

            // checkpoint 停在 tool_running 时，进程无法判断工具是否已经产生副作用。
            // 因此只合成“不确定”结果交给模型核对，绝不自动重放该工具。
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
                if (checkpointPhase === "model_committed" && queuedToolUses.length > 0) {
                    pendingUserContent.push(continuationText);
                } else if (pendingToolResults.current.length > 0) {
                    modelMessages.push({
                        role: "user",
                        content: [
                            ...pendingToolResults.current,
                            {type: "text", text: continuationText},
                        ],
                    });
                    pendingToolResults.current = [];
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

            // 主线 4/8：建立统一的 checkpoint 提交口。模型历史、工具队列、Inbox 去重集、
            // 后台任务和终态都从这里生成同一份快照，避免各分支各自拼装恢复状态。
            let checkpointWriteTail: Promise<void> = Promise.resolve();
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
                    status: input?.status ?? terminalCheckpoint?.status ?? "running",
                    phase: input?.phase ?? (terminalCheckpoint ? "finished" : checkpointPhase),
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
                    backgroundTasks: backgroundTasks.snapshot(),
                    processedInboxMessageIds: [...processedInboxMessageIds].sort(),
                    result: input?.result ?? terminalCheckpoint?.result,
                    error: input?.error ?? terminalCheckpoint?.error,
                    createdAt: checkpointCreatedAt,
                    updatedAt: now,
                };
                // 后台任务结束可能与主循环并发请求保存；按调用顺序串行写入，
                // 防止较旧的 running 快照覆盖较新的 finished checkpoint。
                const write = checkpointWriteTail
                    .catch(() => undefined)
                    .then(() => durableRunStore.save(checkpoint));
                checkpointWriteTail = write;
                await write;
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
                        last.content.push({type: "text", text});
                        return;
                    }
                }

                modelMessages.push({
                    role: "user",
                    content: [
                        ...(toolResults ?? []),
                        ...(text ? [{type: "text" as const, text}] : []),
                    ],
                });
            };

            const flushUserTurn = (text?: string): void => {
                const toolResults = pendingToolResults.current.length
                    ? [...pendingToolResults.current]
                    : undefined;
                appendUserTurn({text, toolResults});
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
                    ? await options.requestToolApproval({toolName, args, reason})
                    : false;

                await options.messageBus?.send({
                    id: `permission-response-${requestId || message.id}`,
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

            // Inbox 子线遵循 claim → 去重 → 写入 Transcript/checkpoint → ack。
            // 崩溃时允许重复领取，但已提交的消息 ID 会阻止模型重复消费。
            const drainLeadInboxForModel = async (): Promise<string | undefined> => {
                if (!options.messageBus) return undefined;
                const claim = options.teammateManager
                    ? await options.teammateManager.claimLeadInbox()
                    : await options.messageBus.claimInbox("lead");
                if (!claim) return undefined;
                const inbox = claim.messages.filter((message) => !processedInboxMessageIds.has(message.id));
                if (inbox.length === 0) {
                    if (options.teammateManager) await options.teammateManager.ackLeadInboxClaim(claim.claimId);
                    else await options.messageBus.ackInboxClaim(claim.claimId);
                    return undefined;
                }

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
                for (const message of inbox) processedInboxMessageIds.add(message.id);
                // 先提交消息 ID 和 Transcript，再确认 claim；
                // 崩溃最多导致 claim 重放，不会让已提交消息消失。
                await persistCheckpoint();
                if (options.teammateManager) await options.teammateManager.ackLeadInboxClaim(claim.claimId);
                else await options.messageBus.ackInboxClaim(claim.claimId);
                return content;
            };

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
                terminalCheckpoint = {status, result};
                checkpointPhase = "finished";
                await persistCheckpoint({status, phase: "finished", result});
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
                    return finish({type: "message", content: promptStop.reason});
                }

                let runModelSteps = 0;
                while (runModelSteps < maxSteps || queuedToolUses.length > 0) {
                    if (runtimeAbortController.signal.aborted) {
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

                        // 模型调用前先封口本轮输入：后台通知、延迟内容和 Inbox 消息
                        // 合并为一个用户轮次，随后保存 before_model checkpoint。
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
                            modelMessages.push({role: "assistant", content: modelResult.content});
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
                            return finish({type: "message", content: responseText});
                        }
                    }

                    // 主线 6/8：进入单个工具事务。先把 activeToolUse 以 tool_running 落盘，
                    // 再做解析、权限判断和 execute，崩溃恢复时才能识别副作用不确定边界。
                    activeToolUse = structuredClone(toolCall);
                    appendRuntimeEventSafely("tool_call", {
                        toolUseId: toolCall.id,
                        toolName: toolCall.name,
                        input: structuredClone(toolCall.input),
                        parseError: toolCall.parseError,
                    }, "model_only");
                    checkpointPhase = "tool_running";
                    await persistCheckpoint();

                    const recordToolResult = (
                        text: string,
                        isError = false,
                        images?: Array<{
                            mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
                            data: string
                        }>,
                    ): void => {
                        if (!toolCall) return;
                        const result: AgentModelToolResultBlock = {
                            type: "tool_result",
                            toolUseId: toolCall.id,
                            content: [
                                {type: "text", text},
                                ...(images ?? []).map((image) => ({type: "image" as const, ...image})),
                            ],
                            ...(isError ? {isError: true} : {}),
                        };
                        const existingIndex = pendingToolResults.current.findIndex(
                            (item) => item.toolUseId === toolCall?.id,
                        );
                        if (existingIndex >= 0) pendingToolResults.current[existingIndex] = result;
                        else pendingToolResults.current.push(result);
                        activeToolUse = undefined;
                        checkpointPhase = "tool_committed";
                        // 先把权威内存状态推进到 tool_committed；循环顶部会在下一步前落盘。
                        // Runtime Event 只做审计投影，写入失败不影响工具结果。
                        appendRuntimeEventSafely("tool_result", {
                            toolUseId: toolCall.id,
                            toolName: toolCall.name,
                            isError,
                            content: structuredClone(result.content),
                        }, "model_only");
                    };

                    if (toolCall.parseError) {
                        emitProgress({
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
                        emitProgress({
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
                    if (args.repairs.length > 0) {
                        appendRuntimeEventSafely("workflow_progress", {
                            type: "tool-input-repaired",
                            toolName: tool.name,
                            toolUseId: toolCall.id,
                            repairs: args.repairs,
                        }, "internal");
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
                            emitProgress({
                                type: "request-status",
                                message: `正在自动修正工具 ${tool.name} 的参数…`,
                                progress: 0,
                            });
                        } else {
                            emitProgress({
                                type: "tool-validation-failed",
                                toolName: tool.name,
                                message: `工具 ${tool.name} 参数连续校验失败`,
                                error: args.error.message,
                            });
                        }
                        transcript.push({role: "tool", toolName: tool.name, error: correction});
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
                            + "TaskGraphCreatePlan(sequential=true, 3-5 concrete steps) before LoadSkill, "
                            + "ReadPresentationSnapshot, or other execution tools. Create the visible task plan first, "
                            + "mark every step executionTarget=teammate or lead. Leave teammate steps pending for the "
                            + "autonomous worker; only claim lead steps, and review submitted teammate work before completion.";
                        emitProgress({
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

                    emitProgress({
                        type: "tool-started",
                        message: `正在调用工具 ${tool.name}...`,
                        toolName: tool.name,
                    });

                    // PreToolUse 是 execute 前唯一可阻止执行的 Hook；一旦进入 execute，
                    // 后续错误只能描述执行事实及副作用确定性，不能再声称工具“未运行”。
                    let preToolStop;
                    try {
                        preToolStop = await triggerHooks("PreToolUse", {
                            event: "PreToolUse",
                            toolName: tool.name,
                            args: args.data,
                            scope: "main",
                            workspaceRoot: options.workspaceRoot,
                            threadId: options.threadId,
                            requestToolApproval: options.requestToolApproval,
                        });
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        const guidance = `PreToolUse failed before ${tool.name} executed: ${errorMessage}`;
                        transcript.push({
                            role: "tool",
                            toolName: tool.name,
                            error: guidance,
                            executionStatus: "not_started"
                        });
                        recordToolResult(guidance, true);
                        continue;
                    }
                    if (preToolStop?.toolDenied) {
                        emitProgress({
                            type: "tool-finished",
                            message: `工具 ${tool.name} 被拒绝: ${preToolStop.reason}`,
                            toolName: tool.name,
                        });
                        transcript.push({role: "tool", toolName: tool.name, error: preToolStop.reason});
                        recordToolResult(preToolStop.reason ?? "Tool call denied.", true);
                        continue;
                    }
                    if (preToolStop) {
                        return finish({type: "message", content: preToolStop.reason});
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
                    if (shouldRunBackground(tool.name, args.data as Record<string, unknown>)) {
                        const label = describeBackgroundTask(tool.name, args.data as Record<string, unknown>);
                        let bgId = "";
                        bgId = backgroundTasks.start({
                            toolName: tool.name,
                            label,
                            toolUseId: toolCall.id,
                            run: async () => {
                                let rawOutput: unknown;
                                try {
                                    rawOutput = await tool.execute(args.data, context);
                                } catch (error) {
                                    const errorMessage = error instanceof Error ? error.message : String(error);
                                    await runPostToolUseHook({
                                        event: "PostToolUse",
                                        toolName: tool.name,
                                        args: args.data,
                                        scope: "main",
                                        executionStatus: "threw",
                                        sideEffects: "uncertain",
                                        error: errorMessage,
                                        threadId: options.threadId,
                                    });
                                    emitProgress({
                                        type: "tool-finished",
                                        message: `后台任务 ${bgId} 执行失败：${errorMessage}`,
                                        toolName: tool.name,
                                    });
                                    throw error;
                                }

                                let output: unknown;
                                try {
                                    output = validateToolOutput(tool, rawOutput);
                                } catch (error) {
                                    const errorMessage = error instanceof Error ? error.message : String(error);
                                    await runPostToolUseHook({
                                        event: "PostToolUse",
                                        toolName: tool.name,
                                        args: args.data,
                                        scope: "main",
                                        executionStatus: "returned",
                                        sideEffects: "committed_or_unknown",
                                        error: errorMessage,
                                        threadId: options.threadId,
                                    });
                                    throw new Error(
                                        `${errorMessage} The tool returned after execution; side effects may already exist.`,
                                    );
                                }

                                await runPostToolUseHook({
                                    event: "PostToolUse",
                                    toolName: tool.name,
                                    args: args.data,
                                    scope: "main",
                                    executionStatus: "returned",
                                    sideEffects: "committed_or_unknown",
                                    result: output,
                                    threadId: options.threadId,
                                });
                                emitProgress({
                                    type: "tool-finished",
                                    message: `后台任务 ${bgId} 已完成：${tool.name}`,
                                    toolName: tool.name,
                                });
                                try {
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
                                    return `Tool ${tool.name} executed successfully, but result post-processing failed: ${errorMessage}. Do not retry blindly; inspect durable artifacts first.`;
                                }
                            },
                        });

                        const placeholder =
                            `[Background task ${bgId} started: ${label}] `
                            + "Result will arrive later as task_notification. Continue with independent work.";
                        transcript.push({
                            role: "tool",
                            toolName: tool.name,
                            result: {backgroundTaskId: bgId, status: "running", label},
                        });
                        recordToolResult(placeholder);
                        emitProgress({
                            type: "workflow-progress",
                            message: `后台任务 ${bgId} 已启动：${label}`,
                            progress: 0,
                        });
                        continue;
                    }

                    // 前台工具严格按 execute → 输出校验 → PostToolUse → 结果后处理推进。
                    // execute 已返回后，即使校验或映射失败，也不能否认可能已经发生的副作用。
                    let rawResult: unknown;
                    try {
                        rawResult = await tool.execute(args.data, context);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        await runPostToolUseHook({
                            event: "PostToolUse",
                            toolName: tool.name,
                            args: args.data,
                            scope: "main",
                            executionStatus: "threw",
                            sideEffects: "uncertain",
                            error: errorMessage,
                            threadId: options.threadId,
                        });
                        emitProgress({
                            type: "tool-finished",
                            message: `工具 ${tool.name} 执行失败: ${errorMessage}`,
                            toolName: tool.name,
                        });
                        const guidance = `${errorMessage}\nThe tool threw after execution started; side effects may be uncertain. Inspect durable artifacts before retrying.`;
                        transcript.push({role: "tool", toolName: tool.name, error: guidance, sideEffects: "uncertain"});
                        recordToolResult(guidance, true);
                        continue;
                    }

                    let result: unknown;
                    try {
                        result = validateToolOutput(tool, rawResult);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        await runPostToolUseHook({
                            event: "PostToolUse",
                            toolName: tool.name,
                            args: args.data,
                            scope: "main",
                            executionStatus: "returned",
                            sideEffects: "committed_or_unknown",
                            error: errorMessage,
                            threadId: options.threadId,
                        });
                        const guidance = `${errorMessage}\nThe tool returned after execution; side effects may already exist. Do not retry blindly.`;
                        transcript.push({
                            role: "tool",
                            toolName: tool.name,
                            error: guidance,
                            executionStatus: "returned",
                            sideEffects: "committed_or_unknown",
                        });
                        recordToolResult(guidance, true);
                        continue;
                    }

                    await runPostToolUseHook({
                        event: "PostToolUse",
                        toolName: tool.name,
                        args: args.data,
                        scope: "main",
                        executionStatus: "returned",
                        sideEffects: "committed_or_unknown",
                        result,
                        threadId: options.threadId,
                    });

                    emitProgress({
                        type: "tool-finished",
                        message: `工具 ${tool.name} 执行完成。`,
                        toolName: tool.name,
                    });

                    try {
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
                                emitProgress({
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

                                emitProgress({
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

                return finish({
                    type: "message",
                    content: [buildMainStepLimitMessage(stepLimits), finalBackgroundContent]
                        .filter(Boolean)
                        .join("\n\n"),
                }, "step_limit");
            // 主线 8/8：任意异常或取消都先写入 failed/interrupted 终态，再触发 Stop Hook。
            // 最外层 finally 只负责释放资源，不参与重新判定本次运行的业务结果。
            } catch (error) {
                const aborted = runtimeAbortController.signal.aborted;
                runtimeAbortController.abort(error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                terminalCheckpoint = {
                    status: aborted ? "interrupted" : "failed",
                    error: errorMessage,
                };
                checkpointPhase = "finished";
                try {
                    await persistCheckpoint({
                        status: aborted ? "interrupted" : "failed",
                        phase: "finished",
                        error: errorMessage,
                    });
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
