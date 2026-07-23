import type { StopBlock } from "./hooks/hook-blocks";
import { triggerHooks } from "./hooks/hook-registry";
import { isRuntimeCancellation } from "./lifecycle/runtime-cancellation";
import type { AgentRuntimeResult } from "./runtime-types";
import type { AgentRunScope } from "./lifecycle/agent-run-scope";

/** Commits the authoritative terminal state before running observational hooks. */
export class AgentRunFinalizer {
  async complete(
    scope: AgentRunScope,
    result: AgentRuntimeResult,
    requestedReason?: StopBlock["reason"],
  ): Promise<AgentRuntimeResult> {
    const status = result.type === "ask_user"
      ? "waiting_user"
      : result.type === "command_proposal"
        ? "proposal_ready"
        : "completed";
    const reason = requestedReason
      ?? (result.type === "ask_user"
        ? "waiting_user"
        : result.type === "command_proposal"
          ? "proposal_ready"
          : "completed");
    const checkpointDecision = scope.applyTransition({ type: "run_terminal", status, result });
    if (checkpointDecision !== "terminal") {
      throw new Error("CheckpointPolicy rejected a Runtime terminal transition.");
    }
    await scope.checkpoints.commitTerminal(scope.createCheckpoint({
      status,
      phase: "finished",
      result,
    }));
    scope.session.sealTerminal();
    await this.runStopHookSafely(scope, {
      event: "Stop",
      threadId: scope.options.threadId,
      scope: "main",
      result,
      reason,
    });
    return result;
  }

  async fail(scope: AgentRunScope, error: unknown): Promise<void> {
    const aborted = isRuntimeCancellation(error, scope.signal, scope.options.signal);
    scope.abort(error);
    const message = error instanceof Error ? error.message : String(error);
    scope.session.overrideTerminalCandidate({
      status: aborted ? "interrupted" : "failed",
      error: message,
    });
    try {
      const terminalSaved = await scope.checkpoints.commitFailureTerminal(scope.createCheckpoint({
        status: aborted ? "interrupted" : "failed",
        phase: "finished",
        error: message,
      }));
      if (!terminalSaved) {
        throw new Error("Failed to persist the Runtime failure terminal checkpoint.");
      }
      scope.session.sealTerminal();
    } catch (checkpointError) {
      scope.eventPorts.audit("workflow_progress", {
        type: "checkpoint-fallback-error",
        error: checkpointError instanceof Error ? checkpointError.message : String(checkpointError),
        primaryError: message,
      }, "internal");
    }
    await this.runStopHookSafely(scope, {
      event: "Stop",
      threadId: scope.options.threadId,
      scope: "main",
      result: message,
      reason: aborted ? "aborted" : "failed",
    });
  }

  private async runStopHookSafely(scope: AgentRunScope, block: StopBlock): Promise<void> {
    try {
      await triggerHooks("Stop", block);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      scope.session.appendTranscript({
        role: "system",
        kind: "hook_error",
        hook: "Stop",
        content: message,
      });
      scope.eventPorts.audit("workflow_progress", {
        type: "stop-hook-error",
        message,
      }, "internal");
    }
  }
}
