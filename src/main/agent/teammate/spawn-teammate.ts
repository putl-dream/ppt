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
import { buildTeammateSystemPrompt } from "./teammate-system-prompt";
import { toToolInputSchema } from "../tools/tool-schema";

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
  workspaceRoot: string;
  gateway: AgentModelGateway;
  model?: AgentModelSelection;
  maxSteps?: number;
  agentStepLimits?: AgentStepLimits;
  idlePollMs?: number;
  permissionPollMs?: number;
}

type TeammateState = TeammateHandle & {
  controller: AbortController;
  done: Promise<void>;
  lastError?: string;
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
    "shutdown_request",
    "error",
  ]).optional().describe("Message type; defaults to message"),
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

  constructor(private readonly bus: MessageBus) {}

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
    }).finally(() => {
      if (state.status !== "failed") state.status = "stopped";
      state.lastActiveAt = Date.now();
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

  async requestShutdown(name: string): Promise<void> {
    const agent = sanitizeAgentName(name);
    const state = this.teammates.get(agent);
    if (!state) {
      throw new Error(`Unknown teammate: ${agent}`);
    }
    if (state.status === "stopped" || state.status === "failed") {
      throw new Error(`Teammate ${agent} is ${state.status}.`);
    }
    await this.bus.send({
      from: "lead",
      to: agent,
      type: "shutdown_request",
      content: "Lead requested teammate shutdown.",
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
    const inbox = new TeammateInboxBuffer(this.bus, state.name);
    const stepLimits = resolveAgentStepLimits(options.agentStepLimits);
    const maxSteps = options.maxSteps ?? getEffectiveSubMaxSteps(stepLimits);
    const idlePollMs = options.idlePollMs ?? 1_000;
    const permissionPollMs = options.permissionPollMs ?? 500;
    const sendMessageTool = createSendMessageTool(this.bus, state.name);
    const tools = [...SUB_AGENT_TOOLS, sendMessageTool];
    const handlers = new Map<string, SubAgentToolDefinition>(
      [...SUB_AGENT_TOOL_HANDLERS.values(), sendMessageTool].map((tool) => [tool.name, tool]),
    );
    const systemPrompt = buildTeammateSystemPrompt({
      name: state.name,
      role: state.role,
      tools,
    });
    const transcript: Array<Record<string, unknown>> = [
      { role: "user", content: options.prompt },
    ];
    const modelMessages: AgentModelMessage[] = [{
      role: "user",
      content: [{ type: "text", text: options.prompt }],
    }];
    const toolSchemas: AgentToolSchema[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toToolInputSchema(tool.inputSchema),
    }));
    const toolContext: SubAgentToolContext = {
      workspaceRoot: options.workspaceRoot,
    };
    const requestToolApproval = createTeammateApprovalHandler({
      bus: this.bus,
      inbox,
      name: state.name,
      signal: state.controller.signal,
      pollMs: permissionPollMs,
    });

    let modelSteps = 0;
    let hasActiveAssignment = true;
    let currentAssignment = options.prompt;

    try {
      while (!state.controller.signal.aborted) {
        const inboxMessages = await inbox.takeAll();
        if (inboxMessages.some((message) => message.type === "shutdown_request")) {
          break;
        }
        if (inboxMessages.length > 0) {
          state.status = "running";
          state.lastActiveAt = Date.now();
          currentAssignment = formatInboxForTeammate(inboxMessages);
          transcript.push({ role: "user", content: currentAssignment });
          modelMessages.push({
            role: "user",
            content: [{ type: "text", text: currentAssignment }],
          });
          modelSteps = 0;
          hasActiveAssignment = true;
        } else if (!hasActiveAssignment) {
          state.status = "idle";
          await sleep(idlePollMs, state.controller.signal);
          continue;
        }

        if (modelSteps >= maxSteps) {
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
          const args = tool.inputSchema.safeParse(call.input);
          if (!args.success) {
            transcript.push({ role: "tool", toolName: tool.name, error: args.error.message });
            record(args.error.message, true);
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
  return `<inbox>${JSON.stringify(messages)}</inbox>`;
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
