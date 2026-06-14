/**
 * Agent 生命周期编排的现有实现与迁移入口。
 *
 * 目标边界：本文件最终只负责 start -> agentRuntime -> commitGate ->
 * approval/apply/reject/fail 的生命周期路由，不负责意图分类、工具实现、
 * 风险计算或真实命令执行细节。
 *
 * 当前状态：旧的 planner、outline review、validate 与 AgentService 仍在本文件中。
 * 本轮只建立目标目录和职责说明，不改变现有运行行为；后续按 docs 中的能力串联
 * 指南逐步迁移。
 */
import { Annotation, Command, interrupt, MemorySaver, StateGraph } from "@langchain/langgraph";
import { executeCommand, presentationCommandSchema, type CommandBus, type PresentationCommand } from "@shared/commands";
import type { AgentRunResult } from "@shared/ipc";
import type { AgentExecutionStrategy, AgentModelSelection } from "@shared/agent";
import {
  createDeterministicPresentationPlanner,
  type AgentPlanner,
} from "./planner";
import { AgentGatewayError } from "./gateway";
import {
  createDeterministicOutlinePlanner,
  outlineToRequest,
  type AgentOutlinePlanner,
  type OutlineConversationMessage,
  type PresentationOutline,
} from "./outline-planner";
import { agentLogger, requestSummary } from "./logger";

const AgentState = Annotation.Root({
  threadId: Annotation<string>(),
  request: Annotation<string>(),
  model: Annotation<AgentModelSelection | undefined>(),
  executionStrategy: Annotation<AgentExecutionStrategy>(),
  summary: Annotation<string>(),
  commands: Annotation<PresentationCommand[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  errors: Annotation<string[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  attempt: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),
});

type AgentStateType = typeof AgentState.State;

export type AgentServiceEvent =
  | { type: "request-status"; message: string; progress: number }
  | { type: "workflow-progress"; message: string; progress: number }
  | { type: "text-delta"; delta: string };

type AgentEventListener = (event: AgentServiceEvent) => void;

function startRequestStatusUpdates(
  listener: AgentEventListener | undefined,
  messages: [string, string, string],
): () => void {
  if (!listener) return () => undefined;

  listener({ type: "request-status", message: messages[0], progress: 6 });
  const timers = [
    setTimeout(() => {
      listener({ type: "request-status", message: messages[1], progress: 12 });
    }, 1_200),
    setTimeout(() => {
      listener({ type: "request-status", message: messages[2], progress: 18 });
    }, 3_500),
  ];
  return () => timers.forEach((timer) => clearTimeout(timer));
}

async function streamAssistantMessage(message: string, listener?: AgentEventListener): Promise<void> {
  if (!listener) return;
  for (const delta of message.match(/[\s\S]{1,3}/g) ?? []) {
    listener({ type: "text-delta", delta });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
}

function routeAfterValidation(
  state: AgentStateType,
): "propose" | "approval" | "apply" | "fail" {
  if (state.errors.length > 0) return state.attempt >= 3 ? "fail" : "propose";
  return state.executionStrategy === "AUTO" ? "apply" : "approval";
}

function approvalNode(state: AgentStateType): Command {
  agentLogger.info("workflow.approval.waiting", {
    threadId: state.threadId,
    commandCount: state.commands.length,
    summary: state.summary,
  });
  const decision = interrupt({
    summary: state.summary,
    commands: state.commands,
  }) as { approved: boolean };
  agentLogger.info("workflow.approval.received", {
    threadId: state.threadId,
    approved: decision.approved,
  });
  return new Command({ goto: decision.approved ? "apply" : "reject" });
}

export function createAgentWorkflow(commandBus: CommandBus, planner: AgentPlanner) {
  const proposeCommands = async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const attempt = state.attempt + 1;
    const startedAt = Date.now();
    agentLogger.info("workflow.planning.started", {
      threadId: state.threadId,
      attempt,
      provider: state.model?.provider,
      model: state.model?.model,
    });
    try {
      const plan = await planner.plan({
        request: state.request,
        presentation: commandBus.getSnapshot(),
        model: state.model,
        feedback: state.errors,
        attempt,
      });
      agentLogger.info("workflow.planning.completed", {
        threadId: state.threadId,
        attempt,
        commandCount: plan.commands.length,
        summary: plan.summary,
        durationMs: Date.now() - startedAt,
      });
      return { ...plan, errors: [], attempt };
    } catch (error) {
      if (error instanceof AgentGatewayError) {
        agentLogger.error("workflow.planning.failed", {
          threadId: state.threadId,
          attempt,
          retryable: false,
          durationMs: Date.now() - startedAt,
          error,
        });
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      agentLogger.warn("workflow.planning.failed", {
        threadId: state.threadId,
        attempt,
        retryable: true,
        durationMs: Date.now() - startedAt,
        error,
      });
      return {
        summary: `Planning attempt ${attempt} failed.`,
        commands: [],
        errors: [message],
        attempt,
      };
    }
  };

  const validateCommands = (state: AgentStateType): Partial<AgentStateType> => {
    if (state.commands.length === 0 && state.errors.length > 0) return {};

    let stagedPresentation = commandBus.getSnapshot();
    const errors: string[] = [];
    for (const command of state.commands) {
      const parsed = presentationCommandSchema.safeParse(command);
      if (!parsed.success) {
        errors.push(parsed.error.message);
        continue;
      }
      try {
        stagedPresentation = executeCommand(stagedPresentation, parsed.data).presentation;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    agentLogger.info("workflow.validation.completed", {
      threadId: state.threadId,
      attempt: state.attempt,
      commandCount: state.commands.length,
      errorCount: errors.length,
      errors,
    });
    return { errors };
  };

  const applyCommands = (state: AgentStateType): Partial<AgentStateType> => {
    agentLogger.info("workflow.commands.applying", {
      threadId: state.threadId,
      commandCount: state.commands.length,
      commandTypes: state.commands.map((command) => command.type),
    });
    commandBus.executeMany(state.commands);
    agentLogger.info("workflow.commands.applied", {
      threadId: state.threadId,
      presentationRevision: commandBus.getSnapshot().revision,
    });
    return {};
  };

  const failPlanning = (state: AgentStateType): never => {
    throw new Error(`Agent could not produce a valid plan after ${state.attempt} attempts: ${state.errors.join(" | ")}`);
  };

  return new StateGraph(AgentState)
    .addNode("propose", proposeCommands)
    .addNode("validate", validateCommands)
    .addNode("approval", approvalNode, { ends: ["apply", "reject"] })
    .addNode("apply", applyCommands)
    .addNode("reject", () => ({}))
    .addNode("fail", failPlanning)
    .addEdge("__start__", "propose")
    .addEdge("propose", "validate")
    .addConditionalEdges("validate", routeAfterValidation)
    .addEdge("apply", "__end__")
    .addEdge("reject", "__end__")
    .compile({ checkpointer: new MemorySaver() });
}

export class AgentService {
  private readonly graph;
  private readonly outlineConversations = new Map<string, {
    messages: OutlineConversationMessage[];
    model?: AgentModelSelection;
    executionStrategy: AgentExecutionStrategy;
    outline?: PresentationOutline;
  }>();

  constructor(
    private readonly commandBus: CommandBus,
    planner: AgentPlanner = createDeterministicPresentationPlanner(),
    private readonly outlinePlanner: AgentOutlinePlanner = createDeterministicOutlinePlanner(),
  ) {
    this.graph = createAgentWorkflow(commandBus, planner);
  }

  restoreOutlineConversation(
    threadId: string,
    messages: OutlineConversationMessage[],
    outline: PresentationOutline | undefined,
    model?: AgentModelSelection,
    executionStrategy: AgentExecutionStrategy = "REQUEST_APPROVAL",
  ): void {
    if (messages.length === 0) return;
    this.outlineConversations.set(threadId, {
      messages: structuredClone(messages),
      model,
      executionStrategy,
      outline: outline ? structuredClone(outline) : undefined,
    });
    agentLogger.info("conversation.outline.restored", {
      threadId,
      messageCount: messages.length,
      outlineSlideCount: outline?.slides.length ?? 0,
      provider: model?.provider,
      model: model?.model,
      executionStrategy,
    });
  }

  async start(
    request: string,
    model?: AgentModelSelection,
    executionStrategy: AgentExecutionStrategy = "REQUEST_APPROVAL",
    listener?: AgentEventListener,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    agentLogger.info("conversation.review.started", {
      ...requestSummary(request),
      provider: model?.provider,
      model: model?.model,
      executionStrategy,
    });
    const messages: OutlineConversationMessage[] = [{ role: "user", content: request }];
    const stopStatusUpdates = startRequestStatusUpdates(listener, [
      "正在理解你的需求...",
      "正在判断最合适的响应方式...",
      "正在组织回复内容，请稍候...",
    ]);
    const decision = await this.outlinePlanner.review({
      messages,
      presentation: this.commandBus.getSnapshot(),
      model,
    }).finally(stopStatusUpdates);
    agentLogger.info("conversation.review.completed", {
      mode: decision.mode,
      intent: decision.intent,
      outlineSlideCount: decision.outline?.slides.length ?? 0,
      missingInformationCount: decision.missingInformation.length,
      durationMs: Date.now() - startedAt,
    });

    if (decision.mode === "chat") {
      await streamAssistantMessage(decision.assistantMessage, listener);
      return { status: "chat", message: decision.assistantMessage };
    }

    listener?.({
      type: "workflow-progress",
      message: "已识别为 PPT 创建或编辑请求。",
      progress: 20,
    });

    if (decision.mode === "ready") {
      listener?.({
        type: "workflow-progress",
        message: "已确认大纲与执行条件，正在规划排版指令...",
        progress: 45,
      });
      return this.runCommandWorkflow(
        decision.outline ? outlineToRequest(decision.outline) : request,
        model,
        executionStrategy,
        listener,
      );
    }

    listener?.({
      type: "workflow-progress",
      message: "已整理演示目标、受众与页面结构。",
      progress: 75,
    });
    listener?.({
      type: "workflow-progress",
      message: "已生成大纲草案，等待继续补充或确认。",
      progress: 100,
    });

    const threadId = crypto.randomUUID();
    this.outlineConversations.set(threadId, {
      messages: [...messages, { role: "assistant", content: decision.assistantMessage }],
      model,
      executionStrategy,
      outline: decision.outline,
    });
    agentLogger.info("conversation.outline.waiting", {
      threadId,
      outlineSlideCount: decision.outline?.slides.length ?? 0,
      missingInformation: decision.missingInformation,
    });
    return {
      status: "outline-required",
      outlineRequest: {
        threadId,
        message: decision.assistantMessage,
        outline: decision.outline,
        missingInformation: decision.missingInformation,
        model,
        executionStrategy,
      },
    };
  }

  async continueOutline(
    threadId: string,
    request: string,
    listener?: AgentEventListener,
  ): Promise<AgentRunResult> {
    const conversation = this.outlineConversations.get(threadId);
    if (!conversation) throw new Error("Outline conversation not found or already completed.");

    const startedAt = Date.now();
    agentLogger.info("conversation.outline.continued", {
      threadId,
      ...requestSummary(request),
      messageCount: conversation.messages.length + 1,
    });
    conversation.messages.push({ role: "user", content: request });
    const stopStatusUpdates = startRequestStatusUpdates(listener, [
      "正在理解你对大纲的补充...",
      "正在结合已有内容判断调整方向...",
      "正在整理更新后的回复，请稍候...",
    ]);
    const decision = await this.outlinePlanner.review({
      messages: conversation.messages,
      presentation: this.commandBus.getSnapshot(),
      model: conversation.model,
      draftOutline: conversation.outline,
    }).finally(stopStatusUpdates);
    agentLogger.info("conversation.outline.reviewed", {
      threadId,
      mode: decision.mode,
      intent: decision.intent,
      outlineSlideCount: decision.outline?.slides.length ?? 0,
      durationMs: Date.now() - startedAt,
    });

    if (decision.mode === "chat") {
      conversation.messages.push({ role: "assistant", content: decision.assistantMessage });
      await streamAssistantMessage(decision.assistantMessage, listener);
      return { status: "chat", message: decision.assistantMessage };
    }

    listener?.({
      type: "workflow-progress",
      message: "已识别为大纲补充或修改请求。",
      progress: 25,
    });

    if (decision.mode === "ready") {
      this.outlineConversations.delete(threadId);
      return this.runCommandWorkflow(
        decision.outline ? outlineToRequest(decision.outline) : request,
        conversation.model,
        conversation.executionStrategy,
        listener,
      );
    }

    listener?.({
      type: "workflow-progress",
      message: "已结合上一版草案更新页面结构。",
      progress: 75,
    });
    listener?.({
      type: "workflow-progress",
      message: "已更新大纲草案，等待继续补充或确认。",
      progress: 100,
    });

    conversation.messages.push({ role: "assistant", content: decision.assistantMessage });
    conversation.outline = decision.outline ?? conversation.outline;
    return {
      status: "outline-required",
      outlineRequest: {
        threadId,
        message: decision.assistantMessage,
        outline: conversation.outline,
        missingInformation: decision.missingInformation,
        model: conversation.model,
        executionStrategy: conversation.executionStrategy,
      },
    };
  }

  async confirmOutline(threadId: string, listener?: AgentEventListener): Promise<AgentRunResult> {
    const conversation = this.outlineConversations.get(threadId);
    if (!conversation) throw new Error("Outline conversation not found or already completed.");
    if (!conversation.outline) throw new Error("The outline is incomplete and cannot be generated yet.");

    agentLogger.info("conversation.outline.confirmed", {
      threadId,
      outlineSlideCount: conversation.outline.slides.length,
    });
    this.outlineConversations.delete(threadId);
    listener?.({
      type: "workflow-progress",
      message: "大纲已确认，正在生成排版指令...",
      progress: 30,
    });
    return this.runCommandWorkflow(
      outlineToRequest(conversation.outline),
      conversation.model,
      conversation.executionStrategy,
      listener,
    );
  }

  private async runCommandWorkflow(
    request: string,
    model: AgentModelSelection | undefined,
    executionStrategy: AgentExecutionStrategy,
    listener?: AgentEventListener,
  ): Promise<AgentRunResult> {
    const threadId = crypto.randomUUID();
    const startedAt = Date.now();
    agentLogger.info("workflow.started", {
      threadId,
      ...requestSummary(request),
      provider: model?.provider,
      model: model?.model,
      executionStrategy,
    });
    try {
      const result = await this.graph.invoke(
        { threadId, request, model, executionStrategy },
        { configurable: { thread_id: threadId } },
      );

      listener?.({
        type: "workflow-progress",
        message: "排版指令规划与校验已完成。",
        progress: 100,
      });

      const runResult = this.toResult(threadId, result);
      agentLogger.info("workflow.finished", {
        threadId,
        status: runResult.status,
        durationMs: Date.now() - startedAt,
      });
      return runResult;
    } catch (error) {
      agentLogger.error("workflow.failed", {
        threadId,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }

  async resume(threadId: string, approved: boolean): Promise<AgentRunResult> {
    const startedAt = Date.now();
    agentLogger.info("workflow.resume.started", { threadId, approved });
    try {
      const result = await this.graph.invoke(new Command({ resume: { approved } }), {
        configurable: { thread_id: threadId },
      });

      const runResult = !approved
        ? { status: "rejected" as const, presentation: this.commandBus.getSnapshot() }
        : this.toResult(threadId, result);
      agentLogger.info("workflow.resume.finished", {
        threadId,
        approved,
        status: runResult.status,
        durationMs: Date.now() - startedAt,
      });
      return runResult;
    } catch (error) {
      agentLogger.error("workflow.resume.failed", {
        threadId,
        approved,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }

  private toResult(threadId: string, result: Record<string, unknown>): AgentRunResult {
    const interrupts = result.__interrupt__ as
      | Array<{ value: { summary: string; commands: PresentationCommand[] } }>
      | undefined;

    if (interrupts?.[0]) {
      return {
        status: "approval-required",
        approval: {
          threadId,
          summary: interrupts[0].value.summary,
          commands: interrupts[0].value.commands,
        },
      };
    }

    return { status: "completed", presentation: this.commandBus.getSnapshot() };
  }
}
