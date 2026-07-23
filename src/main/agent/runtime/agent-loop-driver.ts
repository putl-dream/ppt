import type { AgentLoopTerminalOutcome, PreparedAgentRun } from "./turns/prepared-agent-run";
import { ModelTurnRunner } from "./turns/model-turn-runner";
import { ToolTurnRunner } from "./turns/tool-turn-runner";
import {
  createIterationWorkspace,
  reduceQueryState,
} from "./query/query-types";

/** The single linear queue/model/tool loop for one prepared run. */
export class AgentLoopDriver {
  constructor(
    private readonly modelTurns = new ModelTurnRunner(),
    private readonly toolTurns = new ToolTurnRunner(),
  ) {}

  async run(run: PreparedAgentRun): Promise<AgentLoopTerminalOutcome> {
    const { scope } = run;
    const { session } = scope;
    let state = run.initialState;
    scope.setCommittedQueryState(state);
    while (state.turnCount < run.params.maxTurns) {
      if (scope.signal.aborted) throw new Error("Run aborted by user.");
      const workspace = createIterationWorkspace(state);
      scope.setInflightQuery("model_streaming", workspace);
      const modelOutcome = await this.modelTurns.run(run, state, workspace);
      if (modelOutcome.type === "terminal") return modelOutcome;

      if (modelOutcome.type === "tool_batch") {
        const queuedBatch = session.queuedToolUses;
        if (
          queuedBatch.length !== workspace.toolUseBlocks.length
          || queuedBatch.some((toolUse, index) =>
            toolUse.id !== workspace.toolUseBlocks[index]?.id)
        ) {
          throw new Error("Session tool queue diverged from the current iteration workspace.");
        }
        const toolOutcome = await this.toolTurns.runBatch(
          run,
          workspace.toolUseBlocks,
          workspace,
        );
        if (toolOutcome.type === "terminal") return toolOutcome;
        run.flushUserTurn();
      }

      const next = reduceQueryState(
        state,
        workspace,
        modelOutcome.type === "continue"
          ? { reason: "required_outcome" }
          : { reason: "next_turn" },
      );
      if (JSON.stringify(next.messages) !== JSON.stringify(session.modelMessages)) {
        throw new Error("Committed query state diverged from canonical session messages.");
      }
      scope.setCommittedQueryState(next);
      await scope.persistCheckpoint();
      state = next;
    }
    return await run.resolveStepLimit();
  }
}
