import type { ConversationDatabase } from "../../conversation-database";
import type { AgentModelGateway } from "../gateway";
import { createEmptySkillRegistry, type SkillRegistry } from "../skills/loadSkillsDir";
import { ToolRegistry } from "../tools/tool-registry";
import { AgentLoopDriver } from "./agent-loop-driver";
import { AgentRunFinalizer } from "./agent-run-finalizer";
import { PresentationAgentRunFactory } from "./presentation-agent-run-factory";
import type { AgentRuntimeOptions, AgentRuntimeResult } from "./runtime-types";

/** Public-compatible facade over the prepared Agent lifecycle. */
export class AgentRuntime {
  private readonly runFactory: PresentationAgentRunFactory;
  private readonly loopDriver = new AgentLoopDriver();
  private readonly finalizer = new AgentRunFinalizer();

  constructor(
    registry: ToolRegistry,
    gateway: AgentModelGateway,
    skillRegistry: SkillRegistry = createEmptySkillRegistry(),
    conversationDatabase?: ConversationDatabase,
  ) {
    this.runFactory = new PresentationAgentRunFactory(
      registry,
      gateway,
      skillRegistry,
      conversationDatabase,
    );
  }

  async run(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
    const scope = await this.runFactory.open(options);
    try {
      const prepared = await this.runFactory.prepare(scope);
      const outcome = prepared.type === "short_circuit"
        ? { type: "terminal" as const, result: prepared.result }
        : await this.loopDriver.run(prepared.run);
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
}
