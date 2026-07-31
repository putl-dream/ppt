import type { ConversationDatabase } from "../../conversation-database";
import type { AgentModelGateway } from "../gateway";
import { createEmptySkillRegistry, type SkillRegistry } from "../skills/loadSkillsDir";
import { ToolRegistry } from "../tools/tool-registry";
import { AgentRunFinalizer } from "./agent-run-finalizer";
import { PresentationAgentRunFactory } from "./presentation-agent-run-factory";
import {
  type AgentQueryLoopEvent,
} from "./query/query-types";
import { query } from "./query/query";
import {
  normalizeAgentRuntimeOptions,
  type AgentRuntimeInput,
  type AgentRuntimeResult,
} from "./runtime-types";
import type {
  AgentLoopTerminalOutcome,
  PreparedAgentRun,
} from "./turns/prepared-agent-run";
import type { PptLifecycleToolBridge } from "../tools/tool-definition";
import type { AgentRuntimeOptions } from "./runtime-types";

/** Owns one run lifecycle and consumes the independent query state machine. */
export class AgentRuntime {
  private readonly runFactory: PresentationAgentRunFactory;
  private readonly finalizer = new AgentRunFinalizer();

  constructor(
    registry: ToolRegistry,
    gateway: AgentModelGateway,
    skillRegistry: SkillRegistry = createEmptySkillRegistry(),
    conversationDatabase?: ConversationDatabase,
    resolvePresentationLifecycle?: (input: {
      queryId: import("@shared/presentation-lifecycle").QueryId;
      options: AgentRuntimeOptions;
    }) => PptLifecycleToolBridge | undefined,
  ) {
    this.runFactory = new PresentationAgentRunFactory(
      registry,
      gateway,
      skillRegistry,
      conversationDatabase,
      resolvePresentationLifecycle,
    );
  }

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    const options = normalizeAgentRuntimeOptions(input);
    const scope = await this.runFactory.open(options);
    try {
      const prepared = await this.runFactory.prepare(scope);
      const outcome: AgentLoopTerminalOutcome = prepared.type === "short_circuit"
        ? { type: "terminal" as const, result: prepared.result }
        : await this.runQuery(prepared.run);
      return await this.finalizer.complete(scope, outcome.result, outcome.reason);
    } catch (error) {
      await this.finalizer.fail(scope, error);
      throw error;
    } finally {
      await scope.close();
    }
  }

  clearSession(threadId: string): void {
    this.runFactory.clearSession(threadId);
  }

  private async runQuery(run: PreparedAgentRun): Promise<AgentLoopTerminalOutcome> {
    const iterator = query(run);
    while (true) {
      const next = await iterator.next();
      if (next.done) return next.value;
      safelyNotifyQueryEvent(run.params.deps.onQueryEvent, next.value);
    }
  }
}

function safelyNotifyQueryEvent(
  handler: ((event: AgentQueryLoopEvent) => void) | undefined,
  event: AgentQueryLoopEvent,
): void {
  try {
    handler?.(event);
  } catch {
    // Query events are projections. Observers cannot replace Runtime control flow.
  }
}
