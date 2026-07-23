import type { AgentStepLimits } from "@shared/agent-step-limits";
import { buildMainStepLimitMessage } from "@shared/agent-step-limits";
import type { ConversationDatabase } from "../../../conversation-database";
import type {
  AgentModelGateway,
  AgentModelToolResultBlock,
  AgentToolSchema,
} from "../../gateway/types";
import type { ToolContext } from "../../tools/tool-definition";
import type { AgentRendererEvent } from "../lifecycle/agent-event-ports";
import type { AgentRunScope } from "../lifecycle/agent-run-scope";
import {
  formatBackgroundNotifications,
} from "../background/background-task-manager";
import type { PostToolUseBlock, StopBlock } from "../hooks/hook-blocks";
import type { LeadInboxInputSource } from "../background/lead-inbox-input-source";
import type { PresentationCompletionPolicy } from "../presentation/presentation-completion-policy";
import type { ToolExecutionEngine } from "../tools/tool-execution-engine";
import type { ToolPreflight } from "../tools/tool-preflight";
import { TurnInputAssembler } from "./turn-input-assembler";
import type { AgentRuntimeResult } from "../runtime-types";

export interface AgentLoopTerminalOutcome {
  type: "terminal";
  result: AgentRuntimeResult;
  reason?: StopBlock["reason"];
}

export type AgentLoopTurnOutcome =
  | AgentLoopTerminalOutcome
  | { type: "continue" }
  | { type: "tool_batch" };

/** Prepared, invocation-scoped dependencies consumed by the stable loop and turn runners. */
export class PreparedAgentRun {
  readonly turnInput: TurnInputAssembler;

  constructor(readonly input: {
    scope: AgentRunScope;
    gateway: AgentModelGateway;
    conversationDatabase?: ConversationDatabase;
    systemPrompt: string;
    toolSchemas: AgentToolSchema[];
    context: ToolContext;
    maxSteps: number;
    stepLimits: AgentStepLimits;
    leadInbox: LeadInboxInputSource;
    toolPreflight: ToolPreflight;
    toolExecutionEngine: ToolExecutionEngine;
    presentationCompletionPolicy: PresentationCompletionPolicy;
    runPostToolUseHook(block: PostToolUseBlock): Promise<string[]>;
  }) {
    this.turnInput = new TurnInputAssembler(input.scope.session);
  }

  get scope(): AgentRunScope {
    return this.input.scope;
  }

  emitProgress(event: AgentRendererEvent): void {
    this.scope.eventPorts.renderer(event);
  }

  appendRuntimeEvent(
    kind: Parameters<AgentRunScope["eventPorts"]["audit"]>[0],
    payload: Record<string, unknown>,
    visibility?: Parameters<AgentRunScope["eventPorts"]["audit"]>[2],
  ): void {
    this.scope.eventPorts.audit(kind, payload, visibility);
  }

  appendUserTurn(input: {
    text?: string;
    toolResults?: AgentModelToolResultBlock[];
  }): void {
    this.turnInput.append(input);
  }

  flushUserTurn(text?: string): void {
    const results = this.scope.session.takePendingToolResults();
    this.appendUserTurn({
      text,
      toolResults: results.length ? results : undefined,
    });
  }

  async drainLeadInboxForModel(): Promise<string | undefined> {
    return await this.input.leadInbox.drain();
  }

  async drainBackgroundForModel(instruction: string): Promise<boolean> {
    const { backgroundTasks, session } = this.scope;
    if (!backgroundTasks.hasRunning() && !backgroundTasks.hasPendingNotifications()) return false;
    const notifications = await backgroundTasks.drain(this.scope.signal);
    if (notifications.length === 0) return false;
    const content = `${formatBackgroundNotifications(notifications)}\n\n${instruction}`;
    if (session.hasQueuedToolUses()) {
      session.appendPendingUserContent(content);
    } else {
      this.flushUserTurn(content);
    }
    return true;
  }

  async resolveStepLimit(): Promise<AgentLoopTerminalOutcome> {
    const { options, backgroundTasks, session } = this.scope;
    const notifications = backgroundTasks.hasRunning()
      ? await backgroundTasks.drain(this.scope.signal)
      : backgroundTasks.collect();
    const backgroundContent = notifications.length > 0
      ? formatBackgroundNotifications(notifications)
      : "";
    if (backgroundContent) {
      session.appendTranscript({
        role: "system",
        kind: "background_step_limit_results",
        content: backgroundContent,
      });
    }
    if (options.requiredOutcome === "command_proposal") {
      throw new Error(
        "Agent reached the tool-step limit before resolving the presentation action. "
        + "The conversation remains active and can be continued."
        + (backgroundContent ? `\n\n${backgroundContent}` : ""),
      );
    }
    return {
      type: "terminal",
      result: {
        type: "message",
        content: [buildMainStepLimitMessage(this.input.stepLimits), backgroundContent]
          .filter(Boolean)
          .join("\n\n"),
      },
      reason: "step_limit",
    };
  }
}
