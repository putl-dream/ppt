import type { AgentLoopTerminalOutcome, PreparedAgentRun } from "./prepared-agent-run";
import { ModelTurnRunner } from "./model-turn-runner";
import { ToolTurnRunner } from "./tool-turn-runner";

/** The single linear queue/model/tool loop for one prepared run. */
export class AgentLoopDriver {
  constructor(
    private readonly modelTurns = new ModelTurnRunner(),
    private readonly toolTurns = new ToolTurnRunner(),
  ) {}

  async run(run: PreparedAgentRun): Promise<AgentLoopTerminalOutcome> {
    const { scope } = run;
    const { session } = scope;
    while (session.runModelSteps < run.input.maxSteps || session.hasQueuedToolUses()) {
      if (scope.signal.aborted) throw new Error("Run aborted by user.");
      if (session.phase === "tool_committed") await scope.persistCheckpoint();

      const toolCall = session.takeQueuedToolUse();
      const outcome = toolCall
        ? await this.toolTurns.run(run, toolCall)
        : await this.modelTurns.run(run);
      if (outcome.type === "terminal") return outcome;
    }
    return await run.resolveStepLimit();
  }
}
