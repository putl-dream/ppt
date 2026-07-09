import { z } from "zod";
import type { AgentModelGateway } from "../gateway";
import type { AgentModelSelection } from "@shared/agent";
import type { AgentStepLimits } from "@shared/agent-step-limits";
import {
  buildSubStepLimitMessage,
  getEffectiveSubMaxSteps,
  resolveAgentStepLimits,
} from "@shared/agent-step-limits";
import {
  buildAgentJsonRetryMessage,
  parseAgentJsonResponse,
} from "../runtime/parse-agent-json-response";
import { normalizeAgentProtocolObject } from "../runtime/agent-message-normalizer";
import type { AgentProtocolEnvelope } from "../runtime/runtime-types";
import { callModelWithRecovery } from "../runtime/model-call-recovery";
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

type TeammateStatus = "running" | "idle" | "stopped" | "failed";

export interface TeammateHandle {
  name: string;
  role: string;
  status: TeammateStatus;
  startedAt: number;
  lastActiveAt: number;
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

  async requestShutdown(name: string): Promise<void> {
    const agent = sanitizeAgentName(name);
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

    try {
      while (!state.controller.signal.aborted && modelSteps < maxSteps) {
        const inboxMessages = await inbox.takeAll();
        if (inboxMessages.some((message) => message.type === "shutdown_request")) {
          break;
        }
        if (inboxMessages.length > 0) {
          state.status = "running";
          state.lastActiveAt = Date.now();
          transcript.push({ role: "user", content: formatInboxForTeammate(inboxMessages) });
        } else if (state.status === "idle") {
          await sleep(idlePollMs, state.controller.signal);
          continue;
        }

        const responseText = await generateTeammateResponse({
          options,
          systemPrompt,
          transcript,
          signal: state.controller.signal,
        });
        modelSteps += 1;

        let parsed: unknown;
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

        let envelope: AgentProtocolEnvelope;
        try {
          envelope = normalizeAgentProtocolObject(parsed);
        } catch (error) {
          transcript.push({
            role: "assistant",
            response: parsed,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (envelope.type !== "tool.call") {
          const summary = extractTextFromEnvelope(envelope);
          transcript.push({ role: "assistant", response: envelope });
          await this.bus.send({
            from: state.name,
            to: "lead",
            type: "result",
            content: summary,
          });
          await this.bus.send({
            from: state.name,
            to: "lead",
            type: "idle_notification",
            content: `${state.name} is idle and waiting for inbox messages.`,
          });
          state.status = "idle";
          state.lastActiveAt = Date.now();
          continue;
        }

        const tool = handlers.get(envelope.data.toolName);
        if (!tool) {
          transcript.push({
            role: "tool",
            toolName: envelope.data.toolName,
            error: `Unknown tool: ${envelope.data.toolName}. Teammates cannot use task or spawn teammates.`,
          });
          continue;
        }

        const args = tool.inputSchema.safeParse(envelope.data.args ?? {});
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
            threadId: state.name,
            requestToolApproval,
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
        }
      }

      if (modelSteps >= maxSteps && state.status !== "idle") {
        await this.finishWithSummary(state.name, buildSubStepLimitMessage(stepLimits), "step_limit");
      }
    } catch (error) {
      state.status = "failed";
      await this.bus.send({
        from: state.name,
        to: "lead",
        type: "error",
        content: error instanceof Error ? error.message : String(error),
      });
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
      if (shutdown) return false;

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
  signal: AbortSignal;
}): Promise<string> {
  const result = await callModelWithRecovery({
    gateway: input.options.gateway,
    systemPrompt: input.systemPrompt,
    responseContract: "agent-protocol",
    promptPayload: {
      task: input.options.prompt,
      transcript: input.transcript,
    },
    model: input.options.model,
    workspaceRoot: input.options.workspaceRoot,
    threadId: input.options.name,
    signal: input.signal,
  });
  return result.text;
}

function extractTextFromEnvelope(envelope: AgentProtocolEnvelope): string {
  switch (envelope.type) {
    case "assistant.message":
      return envelope.data.content;
    case "assistant.ask_user":
      return envelope.data.content;
    case "deck.command_proposal":
      return envelope.data.summary;
    case "tool.call":
      return JSON.stringify(envelope.data);
  }
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
