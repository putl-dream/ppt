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
    while (state.turnCount < run.params.maxTurns) {
      if (scope.signal.aborted) throw new Error("Run aborted by user.");
      const isStreamingReplay = replayWorkspace !== undefined;
      const workspace = replayWorkspace ?? createIterationWorkspace(state);
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

      const next = reduceQueryState(
        state,
        workspace,
        modelOutcome.type === "continue"
          ? { reason: "required_outcome" }
          : { reason: "next_turn" },
      );
      scope.setCommittedQueryState(next);
      await scope.persistCheckpoint();
      state = next;
    }
    return await run.resolveStepLimit();
  }
}
