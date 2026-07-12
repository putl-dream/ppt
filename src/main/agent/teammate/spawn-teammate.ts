import { z } from "zod";
import type {
  AgentModelContentBlock,
  AgentModelGateway,
  AgentModelMessage,
  AgentModelToolResultBlock,
  AgentToolSchema,
} from "../gateway/types";
import type { AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import type { AgentTaskNode } from "@shared/agent-task-graph";
import {
  buildSubStepLimitMessage,
  getEffectiveSubMaxSteps,
  resolveAgentStepLimits,
} from "@shared/agent-step-limits";
import { callModelWithRecovery } from "../runtime/model-call-recovery";
import { textFromContentBlocks, toolUseBlocksFromContent } from "../gateway/content-blocks";
import { ensureToolResultPairing } from "../gateway/message-pairing";
import { ensureDefaultHooks } from "../runtime/default-hooks";
import { triggerHooks } from "../runtime/hook-registry";
import type { PostToolUseBlock, StopBlock } from "../runtime/hook-blocks";
import type { ToolApprovalHandler } from "../runtime/permission-check";
import { formatToolApprovalDetail } from "../runtime/format-tool-approval";
import { TaskStore } from "../task/task-store";
import {
  SUB_AGENT_TOOL_HANDLERS,
  SUB_AGENT_TOOLS,
  type SubAgentToolContext,
  type SubAgentToolDefinition,
} from "../subagent/workspace-tools";
import {
  type AgentMailboxMessage,
  type AgentMailboxMessageType,
  MessageBus,
  sanitizeAgentName,
} from "./message-bus";
import {
  type ProtocolState,
  ProtocolStateStore,
  isProtocolResponseType,
  readProtocolRequestId,
  routeProtocolResponses,
} from "./protocol-state";
import { buildTeammateSystemPrompt } from "./teammate-system-prompt";
import {
  claimNextUnclaimedTask,
  createTeammateTaskTools,
  unassignOwnedTasks,
} from "./teammate-task-tools";
import type { TaskGraphSnapshotListener } from "../task/task-graph-publisher";
import { toToolInputSchema } from "../tools/tool-schema";
import { parseToolInput } from "../tools/tool-input";
import { readJsonFile, writeJsonFileAtomic } from "../persistence/atomic-json-file";

type TeammateStatus = "running" | "idle" | "stopped" | "failed";

export interface TeammateHandle {
  name: string;
  role: string;
  status: TeammateStatus;
  startedAt: number;
  lastActiveAt: number;
  lastError?: string;
}

export interface SpawnTeammateThreadOptions {
  name: string;
  role: string;
  prompt: string;
  /** Start by polling the shared board instead of executing prompt as a lead assignment. */
  startIdle?: boolean;
  workspaceRoot: string;
  gateway: AgentModelGateway;
  model?: AgentModelSelection;
  maxSteps?: number;
  agentStepLimits?: AgentStepLimits;
  idlePollMs?: number;
  idleTimeoutMs?: number;
  permissionPollMs?: number;
  /** Current-run listener for publishing durable task board changes. */
  onTaskGraphUpdated?: TaskGraphSnapshotListener;
}

type TeammateState = TeammateHandle & {
  controller: AbortController;
  done: Promise<void>;
  prompt: string;
  lastError?: string;
  taskGraphListener?: TaskGraphSnapshotListener;
};

type PersistedTeammateState = Omit<TeammateHandle, "status"> & {
  status: TeammateStatus | "interrupted";
  prompt: string;
};

const sendMessageSchema = z.object({
  to_agent: z.string().describe("Recipient agent name, e.g. lead or a teammate name"),
  content: z.string().describe("Message content to deliver"),
  msg_type: z.enum([
    "message",
    "result",
    "idle_notification",
    "permission_request",
    "permission_response",
    "error",
  ]).optional().describe("Message type; defaults to message"),
});

const requestPlanApprovalSchema = z.object({
  plan: z.string().trim().min(1).describe(
    "Concrete implementation plan for lead to approve before high-risk or broad changes",
  ),
});

class TeammateInboxBuffer {
  private readonly buffered: AgentMailboxMessage[] = [];

  constructor(
    private readonly bus: MessageBus,
    private readonly name: string,
  ) {}

  async takeAll(): Promise<AgentMailboxMessage[]> {
    const fresh = await this.bus.readInbox(this.name);
    this.buffered.push(...fresh);
    return this.shiftAll();
  }

  pushBack(messages: AgentMailboxMessage[]): void {
    this.buffered.unshift(...messages);
  }

  private shiftAll(): AgentMailboxMessage[] {
    const messages = this.buffered.splice(0);
    return messages;
  }
}

export class TeammateManager {
  private readonly teammates = new Map<string, TeammateState>();
  private readonly protocolStates: ProtocolStateStore;
  private reconcilePromise?: Promise<void>;

  constructor(
    private readonly bus: MessageBus,
    protocolStates?: ProtocolStateStore,
  ) {
    this.protocolStates = protocolStates ?? new ProtocolStateStore(bus.getProtocolStatePath());
  }

  spawn(options: SpawnTeammateThreadOptions): TeammateHandle {
    const name = sanitizeAgentName(options.name);
    const existing = this.teammates.get(name);
    if (existing && existing.status !== "stopped" && existing.status !== "failed") {
      throw new Error(`Teammate already running: ${name}`);
    }

    const controller = new AbortController();
    const state: TeammateState = {
      name,
      role: options.role.trim() || "teammate",
      status: "running",
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      prompt: options.prompt,
      taskGraphListener: options.onTaskGraphUpdated,
      controller,
      done: Promise.resolve(),
    };
    state.done = this.runTeammate(state, {
      ...options,
      name,
      role: state.role,
    }).catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state.status = "failed";
      state.lastError = errorMessage;
      state.lastActiveAt = Date.now();
      try {
        await this.bus.send({
          from: state.name,
          to: "lead",
          type: "error",
          content: errorMessage,
        });
      } catch (notifyError) {
        const notifyMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
        state.lastError = `${errorMessage}; failed to notify lead: ${notifyMessage}`;
      }
    }).finally(async () => {
      if (state.status !== "failed") state.status = "stopped";
      state.lastActiveAt = Date.now();
      await this.persistTeammateStates();
    });
    this.teammates.set(name, state);

    return this.toHandle(state);
  }

  list(): TeammateHandle[] {
    return Array.from(this.teammates.values()).map((state) => this.toHandle(state));
  }

  get(name: string): TeammateHandle | undefined {
    const state = this.teammates.get(sanitizeAgentName(name));
    return state ? this.toHandle(state) : undefined;
  }

  updateTaskGraphListener(
    name: string,
    listener?: TaskGraphSnapshotListener,
  ): boolean {
    const state = this.teammates.get(sanitizeAgentName(name));
    if (!state) return false;
    state.taskGraphListener = listener;
    return true;
  }

  async requestShutdown(name: string, reason = "Lead requested teammate shutdown."): Promise<ProtocolState> {
    await this.protocolStates.hydrate();
    const agent = sanitizeAgentName(name);
    const state = this.teammates.get(agent);
    if (!state) {
      throw new Error(`Unknown teammate: ${agent}`);
    }
    if (state.status === "stopped" || state.status === "failed") {
      throw new Error(`Teammate ${agent} is ${state.status}.`);
    }
    const existing = this.protocolStates.findPending({
      type: "shutdown",
      sender: "lead",
      target: agent,
    });
    if (existing) return existing;

    const request = this.protocolStates.createRequest({
      type: "shutdown",
      sender: "lead",
      target: agent,
      payload: reason,
    });
    await this.protocolStates.flush();
    try {
      await this.bus.send({
        from: "lead",
        to: agent,
        type: "shutdown_request",
        content: reason,
        payload: { requestId: request.requestId },
      });
    } catch (error) {
      this.protocolStates.remove(request.requestId);
      await this.protocolStates.flush();
      throw error;
    }
    return request;
  }

  async respondPlanApproval(
    requestId: string,
    approve: boolean,
    reason = "",
  ): Promise<ProtocolState> {
    await this.protocolStates.hydrate();
    const request = this.protocolStates.get(requestId);
    if (!request) throw new Error(`Unknown protocol request: ${requestId}`);
    if (request.type !== "plan_approval") {
      throw new Error(`Request ${requestId} is ${request.type}, not plan_approval.`);
    }
    if (request.status !== "pending") {
      throw new Error(`Request ${requestId} is already ${request.status}.`);
    }
    if (request.target !== "lead") {
      throw new Error(`Request ${requestId} is not addressed to lead.`);
    }

    await this.bus.send({
      from: "lead",
      to: request.sender,
      type: "plan_approval_response",
      content: reason || (approve ? "Plan approved by lead." : "Plan rejected by lead."),
      payload: { requestId, approve, reason },
    });
    return request;
  }

  async consumeLeadInbox(): Promise<AgentMailboxMessage[]> {
    await this.protocolStates.hydrate();
    const messages = await this.bus.readInbox("lead");
    routeProtocolResponses(messages, this.protocolStates);
    await this.protocolStates.flush();
    return messages;
  }

  getProtocolState(requestId: string): ProtocolState | undefined {
    return this.protocolStates.get(requestId);
  }

  listProtocolStates(): ProtocolState[] {
    return this.protocolStates.list();
  }

  /**
   * A teammate model loop cannot be safely replayed after a process crash.
   * Convert persisted running entries into durable interruption messages so
   * the lead can inspect artifacts/tasks and explicitly re-delegate.
   */
  async reconcileInterrupted(): Promise<void> {
    if (!this.reconcilePromise) {
      this.reconcilePromise = (async () => {
        const filePath = this.bus.getTeammateStatePath();
        const stored = await readJsonFile<{ version: 1; teammates: PersistedTeammateState[] }>(filePath);
        if (!stored) return;
        let changed = false;
        for (const teammate of stored.teammates) {
          if (teammate.status !== "running" && teammate.status !== "idle") continue;
          changed = true;
          teammate.status = "interrupted";
          teammate.lastError = "Application restarted before the teammate committed its final result.";
          teammate.lastActiveAt = Date.now();
          await this.bus.send({
            from: teammate.name,
            to: "lead",
            type: "error",
            content:
              `Teammate ${teammate.name} was interrupted by application restart. `
              + "Its task claims will be reclaimed; inspect durable artifacts before re-delegating.",
            payload: { role: teammate.role, prompt: teammate.prompt, recoverable: true },
          });
        }
        if (changed) await writeJsonFileAtomic(filePath, stored);
      })();
    }
    await this.reconcilePromise;
  }

  private async persistTeammateStates(): Promise<void> {
    await writeJsonFileAtomic(this.bus.getTeammateStatePath(), {
      version: 1,
      teammates: Array.from(this.teammates.values()).map((state): PersistedTeammateState => ({
        name: state.name,
        role: state.role,
        status: state.status,
        startedAt: state.startedAt,
        lastActiveAt: state.lastActiveAt,
        prompt: state.prompt,
        ...(state.lastError ? { lastError: state.lastError } : {}),
      })),
    });
  }

  async waitFor(name: string): Promise<void> {
    const state = this.teammates.get(sanitizeAgentName(name));
    await state?.done;
  }

  private toHandle(state: TeammateState): TeammateHandle {
    return {
      name: state.name,
      role: state.role,
      status: state.status,
      startedAt: state.startedAt,
      lastActiveAt: state.lastActiveAt,
      ...(state.lastError ? { lastError: state.lastError } : {}),
    };
  }

  private async runTeammate(
    state: TeammateState,
    options: SpawnTeammateThreadOptions,
  ): Promise<void> {
    ensureDefaultHooks();
    await this.protocolStates.hydrate();
    await this.persistTeammateStates();
    const inbox = new TeammateInboxBuffer(this.bus, state.name);
    const taskStore = new TaskStore(options.workspaceRoot);
    const publishTaskGraph: TaskGraphSnapshotListener = (snapshot) => {
      state.taskGraphListener?.(snapshot);
    };
    const stepLimits = resolveAgentStepLimits(options.agentStepLimits);
    const maxSteps = options.maxSteps ?? Math.min(getEffectiveSubMaxSteps(stepLimits), 10);
    const idlePollMs = options.idlePollMs ?? 5_000;
    const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    const permissionPollMs = options.permissionPollMs ?? 500;
    const sendMessageTool = createSendMessageTool(this.bus, state.name);
    const requestPlanApprovalTool = createRequestPlanApprovalTool(
      this.bus,
      this.protocolStates,
      state.name,
    );
    const taskTools = createTeammateTaskTools(taskStore, state.name, publishTaskGraph);
    const tools = [
      ...SUB_AGENT_TOOLS,
      ...taskTools,
      sendMessageTool,
      requestPlanApprovalTool,
    ];
    const handlers = new Map<string, SubAgentToolDefinition>(
      [
        ...SUB_AGENT_TOOL_HANDLERS.values(),
        ...taskTools,
        sendMessageTool,
        requestPlanApprovalTool,
      ]
        .map((tool) => [tool.name, tool]),
    );
    const systemPrompt = buildTeammateSystemPrompt({
      name: state.name,
      role: state.role,
      tools,
    });
    const transcript: Array<Record<string, unknown>> = options.startIdle
      ? []
      : [{ role: "user", content: options.prompt }];
    const modelMessages: AgentModelMessage[] = options.startIdle
      ? []
      : [{ role: "user", content: [{ type: "text", text: options.prompt }] }];
    const toolSchemas: AgentToolSchema[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toToolInputSchema(tool.inputSchema),
    }));
    const toolContext: SubAgentToolContext = {
      workspaceRoot: options.workspaceRoot,
      gatewayConfig: options.gateway.getGatewayConfig?.(),
      signal: state.controller.signal,
    };
    const requestToolApproval = createTeammateApprovalHandler({
      bus: this.bus,
      inbox,
      name: state.name,
      signal: state.controller.signal,
      pollMs: permissionPollMs,
    });

    let modelSteps = 0;
    let hasActiveAssignment = !options.startIdle;
    let currentAssignment = options.startIdle ? "" : options.prompt;
    let currentTaskId: string | undefined;
    let idleSince: number | undefined = options.startIdle ? Date.now() : undefined;
    let nextIdlePollAt: number | undefined = options.startIdle ? Date.now() : undefined;
    const workSummaries: string[] = [];

    try {
      while (!state.controller.signal.aborted) {
        const inboxMessages = await inbox.takeAll();
        const matchedResponses = routeProtocolResponses(inboxMessages, this.protocolStates);
        if (matchedResponses.length > 0) await this.protocolStates.flush();
        const matchedRequestIds = new Set(
          matchedResponses.map((response) => response.requestId),
        );
        const shutdownRequest = inboxMessages.find(
          (message) => {
            if (message.type !== "shutdown_request" || message.from !== "lead") return false;
            const request = this.protocolStates.get(readProtocolRequestId(message.payload));
            return request?.type === "shutdown"
              && request.status === "pending"
              && request.sender === "lead"
              && request.target === state.name;
          },
        );
        const routedInboxMessages = inboxMessages.filter((message) => {
          if (message.type === "shutdown_request") return message === shutdownRequest;
          return !isProtocolResponseType(message.type)
            || matchedRequestIds.has(readProtocolRequestId(message.payload));
        });
        if (shutdownRequest) {
          const requestId = readProtocolRequestId(shutdownRequest.payload);
          await unassignOwnedTasks(taskStore, state.name, publishTaskGraph);
          currentTaskId = undefined;
          await this.sendLifecycleSummary(state.name, "shutdown requested", workSummaries);
          await this.bus.send({
            from: state.name,
            to: shutdownRequest.from,
            type: "shutdown_response",
            content: `${state.name} finished its current operation and is shutting down.`,
            payload: { requestId, approve: true },
          });
          break;
        }
        if (routedInboxMessages.length > 0) {
          state.status = "running";
          state.lastActiveAt = Date.now();
          const inboxAssignment = formatInboxForTeammate(routedInboxMessages);
          currentAssignment = hasActiveAssignment
            ? inboxAssignment
            : withIdentityIfCompacted(
                modelMessages,
                state.name,
                state.role,
                inboxAssignment,
              );
          transcript.push({ role: "user", content: currentAssignment });
          modelMessages.push({
            role: "user",
            content: [{ type: "text", text: currentAssignment }],
          });
          modelSteps = 0;
          hasActiveAssignment = true;
          idleSince = undefined;
          nextIdlePollAt = undefined;
        } else if (!hasActiveAssignment) {
          state.status = "idle";
          const now = Date.now();
          idleSince ??= now;
          nextIdlePollAt ??= now + idlePollMs;
          if (now - idleSince >= idleTimeoutMs) {
            await this.sendLifecycleSummary(state.name, "idle timeout", workSummaries);
            break;
          }
          if (now < nextIdlePollAt) {
            await sleep(
              Math.min(nextIdlePollAt - now, idleTimeoutMs - (now - idleSince)),
              state.controller.signal,
            );
            continue;
          }

          nextIdlePollAt = now + idlePollMs;
          const claimedTask = await claimNextUnclaimedTask(
            taskStore,
            state.name,
            publishTaskGraph,
          );
          if (!claimedTask) continue;

          currentTaskId = claimedTask.id;
          currentAssignment = withIdentityIfCompacted(
            modelMessages,
            state.name,
            state.role,
            formatClaimedTaskAssignment(claimedTask),
          );
          transcript.push({ role: "user", content: currentAssignment, task: claimedTask });
          modelMessages.push({
            role: "user",
            content: [{ type: "text", text: currentAssignment }],
          });
          state.status = "running";
          state.lastActiveAt = Date.now();
          modelSteps = 0;
          hasActiveAssignment = true;
          idleSince = undefined;
          nextIdlePollAt = undefined;
        }

        if (modelSteps >= maxSteps) {
          await unassignOwnedTasks(taskStore, state.name, publishTaskGraph);
          currentTaskId = undefined;
          await this.finishWithSummary(
            state.name,
            buildSubStepLimitMessage(stepLimits),
            "step_limit",
          );
          await this.sendIdleNotification(
            state.name,
            `${state.name} hit the assignment step limit and is idle awaiting new instructions.`,
          );
          state.status = "idle";
          state.lastActiveAt = Date.now();
          modelSteps = 0;
          hasActiveAssignment = false;
          idleSince = Date.now();
          nextIdlePollAt = idleSince + idlePollMs;
          continue;
        }

        const responseContent = await generateTeammateResponse({
          options,
          systemPrompt,
          transcript,
          modelMessages,
          tools: toolSchemas,
          task: currentAssignment,
          signal: state.controller.signal,
        });
        modelSteps += 1;
        modelMessages.push({ role: "assistant", content: responseContent });
        const calls = toolUseBlocksFromContent(responseContent);
        if (calls.length === 0) {
          const summary = textFromContentBlocks(responseContent);
          transcript.push({ role: "assistant", content: summary });
          if (currentTaskId) {
            const currentTask = await taskStore.getTask(currentTaskId);
            if (currentTask.status === "in_progress" && currentTask.owner === state.name) {
              const guidance =
                `Task ${currentTaskId} is still in_progress. Finish its concrete work and call `
                + `submit_task({"task_id":"${currentTaskId}"}) before returning a summary for lead review.`;
              transcript.push({ role: "user", content: guidance });
              modelMessages.push({
                role: "user",
                content: [{ type: "text", text: guidance }],
              });
              currentAssignment = guidance;
              continue;
            }
            currentTaskId = undefined;
          }
          workSummaries.push(summary);
          await this.bus.send({
            from: state.name,
            to: "lead",
            type: "result",
            content: summary,
          });
          await this.sendIdleNotification(state.name);
          state.status = "idle";
          state.lastActiveAt = Date.now();
          modelSteps = 0;
          hasActiveAssignment = false;
          idleSince = Date.now();
          nextIdlePollAt = idleSince + idlePollMs;
          continue;
        }

        const results: AgentModelToolResultBlock[] = [];
        for (const call of calls) {
          const record = (text: string, isError = false): void => {
            results.push({
              type: "tool_result",
              toolUseId: call.id,
              content: [{ type: "text", text }],
              ...(isError ? { isError: true } : {}),
            });
          };
          if (call.parseError) {
            transcript.push({ role: "tool", toolName: call.name, error: call.parseError });
            record(call.parseError, true);
            continue;
          }
          const tool = handlers.get(call.name);
          if (!tool) {
            const error = `Unknown tool: ${call.name}. Teammates cannot use task or spawn teammates.`;
            transcript.push({ role: "tool", toolName: call.name, error });
            record(error, true);
            continue;
          }
          const args = parseToolInput(tool.inputSchema, call.input);
          if (!args.success) {
            transcript.push({ role: "tool", toolName: tool.name, error: args.error.message });
            record(args.error.message, true);
            continue;
          }

          const latestPlanRequest = this.protocolStates.list()
            .filter((request) => request.type === "plan_approval" && request.sender === state.name)
            .at(-1);
          if (
            requiresApprovedPlan(tool.name)
            && latestPlanRequest
            && latestPlanRequest.status !== "approved"
          ) {
            const error = latestPlanRequest.status === "pending"
              ? `Plan approval ${latestPlanRequest.requestId} is still pending.`
              : `Plan approval ${latestPlanRequest.requestId} was rejected. Submit a revised plan before making changes.`;
            transcript.push({ role: "tool", toolName: tool.name, error });
            record(error, true);
            continue;
          }

          try {
          const preToolStop = await triggerHooks("PreToolUse", {
            event: "PreToolUse",
            toolName: tool.name,
            args: args.data,
            scope: "subagent",
            workspaceRoot: options.workspaceRoot,
            threadId: state.name,
            requestToolApproval,
          });
          if (preToolStop?.toolDenied) {
            transcript.push({
              role: "tool",
              toolName: tool.name,
              error: preToolStop.reason,
            });
            record(preToolStop.reason ?? "Tool call denied.", true);
            continue;
          }
          if (preToolStop) {
            await this.finishWithSummary(state.name, preToolStop.reason, "completed");
            return;
          }

          const output = await tool.execute(args.data, toolContext);
          await triggerHooks("PostToolUse", {
            event: "PostToolUse",
            toolName: tool.name,
            args: args.data,
            scope: "subagent",
            result: output,
            threadId: state.name,
          } satisfies PostToolUseBlock);
          transcript.push({ role: "tool", toolName: tool.name, result: output });
          record(output);
          } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await triggerHooks("PostToolUse", {
            event: "PostToolUse",
            toolName: tool.name,
            args: args.data,
            scope: "subagent",
            error: errorMessage,
            threadId: state.name,
          } satisfies PostToolUseBlock);
          transcript.push({
            role: "tool",
            toolName: tool.name,
            error: errorMessage,
          });
          record(errorMessage, true);
          }
        }
        modelMessages.push({ role: "user", content: results });
      }

    } catch (error) {
      state.status = "failed";
      state.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await unassignOwnedTasks(taskStore, state.name, publishTaskGraph);
      await triggerHooks("Stop", {
        event: "Stop",
        scope: "subagent",
        result: state.status,
        reason: state.status === "failed" ? "aborted" : "completed",
        threadId: state.name,
      } satisfies StopBlock);
    }
  }

  private async finishWithSummary(
    name: string,
    content: string,
    reason: StopBlock["reason"],
  ): Promise<void> {
    await this.bus.send({
      from: name,
      to: "lead",
      type: reason === "step_limit" ? "error" : "result",
      content,
    });
  }

  private async sendIdleNotification(
    name: string,
    content = `${name} is idle and waiting for inbox messages.`,
  ): Promise<void> {
    await this.bus.send({
      from: name,
      to: "lead",
      type: "idle_notification",
      content,
    });
  }

  private async sendLifecycleSummary(
    name: string,
    reason: string,
    workSummaries: string[],
  ): Promise<void> {
    const completed = workSummaries.length;
    await this.bus.send({
      from: name,
      to: "lead",
      type: "result",
      content: `${name} is shutting down after ${reason}. Completed ${completed} work cycle${completed === 1 ? "" : "s"}.`,
      payload: { reason, completedWorkCycles: completed },
    });
  }
}

function createSendMessageTool(
  bus: MessageBus,
  fromAgent: string,
): SubAgentToolDefinition<typeof sendMessageSchema> {
  return {
    name: "send_message",
    description: "Send a message to lead or another teammate through the file-backed MessageBus.",
    inputSchema: sendMessageSchema,
    permission: {
      profile: "message-bus",
      description: "Send a structured mailbox message to another agent.",
      scopes: ["subagent"],
      effects: ["workflow.delegate"],
      sandbox: "workspace",
      approval: "never",
    },
    async execute(args) {
      const type = (args.msg_type ?? "message") as AgentMailboxMessageType;
      const message = await bus.send({
        from: fromAgent,
        to: args.to_agent,
        content: args.content,
        type,
      });
      return `Sent ${message.type} to ${message.to}.`;
    },
  };
}

function createRequestPlanApprovalTool(
  bus: MessageBus,
  states: ProtocolStateStore,
  fromAgent: string,
): SubAgentToolDefinition<typeof requestPlanApprovalSchema> {
  return {
    name: "request_plan_approval",
    description:
      "Submit a concrete high-risk or broad-change plan to lead and wait for an approval response before changing files.",
    inputSchema: requestPlanApprovalSchema,
    permission: {
      profile: "message-bus",
      description: "Request lead approval for a teammate implementation plan.",
      scopes: ["subagent"],
      effects: ["workflow.delegate"],
      sandbox: "workspace",
      approval: "never",
    },
    async execute(args) {
      await states.hydrate();
      const existing = states.findPending({
        type: "plan_approval",
        sender: fromAgent,
        target: "lead",
      });
      if (existing) {
        return `Plan approval ${existing.requestId} is already pending. Wait for lead's response.`;
      }

      const request = states.createRequest({
        type: "plan_approval",
        sender: fromAgent,
        target: "lead",
        payload: args.plan,
      });
      await states.flush();
      try {
        await bus.send({
          from: fromAgent,
          to: "lead",
          type: "plan_approval_request",
          content: args.plan,
          payload: { requestId: request.requestId },
        });
      } catch (error) {
        states.remove(request.requestId);
        await states.flush();
        throw error;
      }
      return `Plan approval ${request.requestId} is pending. Do not make changes until lead responds.`;
    },
  };
}

function createTeammateApprovalHandler(input: {
  bus: MessageBus;
  inbox: TeammateInboxBuffer;
  name: string;
  signal: AbortSignal;
  pollMs: number;
}): ToolApprovalHandler {
  return async (request) => {
    const requestId = crypto.randomUUID();
    await input.bus.send({
      from: input.name,
      to: "lead",
      type: "permission_request",
      content: `Tool ${request.toolName} needs approval: ${request.reason}`,
      payload: {
        requestId,
        toolName: request.toolName,
        args: request.args,
        reason: request.reason,
        detail: formatToolApprovalDetail(request.toolName, request.args),
      },
    });

    while (!input.signal.aborted) {
      const messages = await input.inbox.takeAll();
      const shutdown = messages.some((message) => message.type === "shutdown_request");
      if (shutdown) {
        input.inbox.pushBack(messages);
        return false;
      }

      const response = messages.find((message) =>
        message.type === "permission_response"
        && message.payload?.requestId === requestId,
      );
      input.inbox.pushBack(messages.filter((message) => message !== response));
      if (response) {
        return response.payload?.approved === true;
      }
      await sleep(input.pollMs, input.signal);
    }

    return false;
  };
}

async function generateTeammateResponse(input: {
  options: SpawnTeammateThreadOptions;
  systemPrompt: string;
  transcript: Array<Record<string, unknown>>;
  modelMessages: AgentModelMessage[];
  tools: AgentToolSchema[];
  task: string;
  signal: AbortSignal;
}): Promise<AgentModelContentBlock[]> {
  const result = await callModelWithRecovery({
    gateway: input.options.gateway,
    systemPrompt: input.systemPrompt,
    promptPayload: {
      task: input.task,
      transcript: input.transcript,
    },
    model: input.options.model,
    workspaceRoot: input.options.workspaceRoot,
    threadId: input.options.name,
    signal: input.signal,
    tools: input.tools,
    messages: ensureToolResultPairing(input.modelMessages),
  });
  return result.content;
}

function formatInboxForTeammate(messages: AgentMailboxMessage[]): string {
  const formatted = messages.map((message) => {
    if (message.type !== "plan_approval_response") return message;
    const requestId = readProtocolRequestId(message.payload);
    const status = message.payload?.approve === true ? "approved" : "rejected";
    return {
      ...message,
      content: `[Plan ${status}] ${requestId}: ${message.content}`,
    };
  });
  return `<inbox>${JSON.stringify(formatted)}</inbox>`;
}

function formatClaimedTaskAssignment(task: AgentTaskNode): string {
  return `<task_assignment source="task_board" owner="${task.owner}">
${JSON.stringify(task, null, 2)}
</task_assignment>
This task has already been claimed for you. Complete the concrete work, then call submit_task with task_id "${task.id}" before returning your summary for lead review.`;
}

function withIdentityIfCompacted(
  messages: AgentModelMessage[],
  name: string,
  role: string,
  assignment: string,
): string {
  if (messages.length > 3) return assignment;
  return `<identity>You are '${name}', role: ${role}. Continue your work.</identity>\n${assignment}`;
}

function requiresApprovedPlan(toolName: string): boolean {
  return toolName === "write_file"
    || toolName === "edit_file"
    || toolName === "ensure_dir"
    || toolName === "bash";
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    if (typeof timeout === "object" && "unref" in timeout) {
      timeout.unref();
    }
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
