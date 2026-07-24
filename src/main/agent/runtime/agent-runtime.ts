import type { ConversationDatabase } from "../../conversation-database";
import type { AgentModelGateway } from "../gateway";
import { createEmptySkillRegistry, type SkillRegistry } from "../skills/loadSkillsDir";
import { ToolRegistry } from "../tools/tool-registry";
import { AgentRunFinalizer } from "./agent-run-finalizer";
import { PresentationAgentRunFactory } from "./presentation-agent-run-factory";
import {
  createIterationWorkspace,
  reduceQueryState,
} from "./query/query-types";
import {
  normalizeAgentRuntimeOptions,
  type AgentRuntimeInput,
  type AgentRuntimeResult,
} from "./runtime-types";
import { ModelTurnRunner } from "./turns/model-turn-runner";
import type {
  AgentLoopTerminalOutcome,
  PreparedAgentRun,
} from "./turns/prepared-agent-run";
import { ToolTurnRunner } from "./turns/tool-turn-runner";

/** Owns the complete lifecycle and linear model → tools → state loop for one query. */
export class AgentRuntime {
  private readonly runFactory: PresentationAgentRunFactory;
  private readonly modelTurns = new ModelTurnRunner();
  private readonly toolTurns = new ToolTurnRunner();
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
    const { scope } = run;
    let state = run.initialState;
    scope.setCommittedQueryState(state);

    if (run.initialWorkspace && run.initialWorkspacePhase !== "model_streaming") {
      const workspace = run.initialWorkspace;
      scope.setInflightQuery("model_received", workspace);
      if (workspace.toolResults.length < workspace.toolUseBlocks.length) {
        const toolOutcome = await this.toolTurns.runBatch(
          run,
          workspace.toolUseBlocks,
          workspace,
          state,
        );
        if (toolOutcome.type === "terminal") return toolOutcome;
      }
      state = reduceQueryState(state, workspace);
      scope.setCommittedQueryState(state);
      await scope.persistCheckpoint();
    }

    let replayWorkspace = run.initialWorkspacePhase === "model_streaming"
      ? run.initialWorkspace
      : undefined;

    while (true) {
      if (state.turnCount >= run.params.maxTurns) {
        return await run.resolveStepLimit();
      }
      if (scope.signal.aborted) throw new Error("Run aborted by user.");

      const workspace = replayWorkspace ?? createIterationWorkspace(state);
      const isStreamingReplay = replayWorkspace !== undefined;
      replayWorkspace = undefined;
      if (!isStreamingReplay) {
        scope.setInflightQuery("model_streaming", workspace);
      }

      const modelOutcome = await this.modelTurns.run(run, state, workspace);
      if (modelOutcome.type === "terminal") return modelOutcome;

      if (modelOutcome.type === "tool_batch") {
        const toolOutcome = await this.toolTurns.runBatch(
          run,
          workspace.toolUseBlocks,
          workspace,
          state,
        );
        if (toolOutcome.type === "terminal") return toolOutcome;
      }

      state = reduceQueryState(
        state,
        workspace,
        modelOutcome.type === "continue"
          ? { reason: "required_outcome" }
          : { reason: "next_turn" },
      );
      scope.setCommittedQueryState(state);
      await scope.persistCheckpoint();
    }
  }
}
