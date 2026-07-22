import type {
  AgentModelMessage,
  AgentModelToolResultBlock,
  AgentModelToolUseBlock,
} from "../gateway/types";
import type {
  DurableRunPhase,
  DurableRunStatus,
} from "../persistence/durable-run-store";
import type { AgentRuntimeResult } from "./runtime-types";
import type { AgentTransition } from "./agent-transition";

export interface AgentTerminalState {
  status: DurableRunStatus;
  result?: AgentRuntimeResult;
  error?: string;
  sealed: boolean;
}

export interface AgentSessionInput {
  transcript: Array<Record<string, unknown>>;
  modelMessages: AgentModelMessage[];
  queuedToolUses?: AgentModelToolUseBlock[];
  pendingToolResults?: AgentModelToolResultBlock[];
  pendingUserContent?: string[];
  processedInboxMessageIds?: string[];
  activeToolUse?: AgentModelToolUseBlock;
  phase?: DurableRunPhase;
  totalModelSteps?: number;
  renderFeedbackUsed?: boolean;
}

/**
 * Mutable state for one Runtime invocation.
 *
 * Phase 1 intentionally centralizes the existing state without changing when
 * model, tool, or checkpoint side effects occur. Later phases drive these
 * methods exclusively through AgentTransition values.
 */
export class AgentSession {
  readonly transcript: Array<Record<string, unknown>>;
  readonly modelMessages: AgentModelMessage[];
  readonly queuedToolUses: AgentModelToolUseBlock[];
  readonly pendingUserContent: string[];
  readonly processedInboxMessageIds: Set<string>;
  readonly validationFailuresByTool = new Map<string, number>();

  private pendingToolResultsValue: AgentModelToolResultBlock[];
  private activeToolUseValue?: AgentModelToolUseBlock;
  private phaseValue: DurableRunPhase;
  private totalModelStepsValue: number;
  private runModelStepsValue = 0;
  private renderFeedbackUsedValue: boolean;
  private terminalStateValue?: AgentTerminalState;

  constructor(input: AgentSessionInput) {
    this.transcript = input.transcript;
    this.modelMessages = input.modelMessages;
    this.queuedToolUses = input.queuedToolUses ?? [];
    this.pendingToolResultsValue = input.pendingToolResults ?? [];
    this.pendingUserContent = input.pendingUserContent ?? [];
    this.processedInboxMessageIds = new Set(input.processedInboxMessageIds ?? []);
    this.activeToolUseValue = input.activeToolUse;
    this.phaseValue = input.phase ?? "before_model";
    this.totalModelStepsValue = input.totalModelSteps ?? 0;
    this.renderFeedbackUsedValue = input.renderFeedbackUsed ?? false;
  }

  get pendingToolResults(): AgentModelToolResultBlock[] {
    return this.pendingToolResultsValue;
  }

  replacePendingToolResults(results: AgentModelToolResultBlock[]): void {
    this.pendingToolResultsValue = results;
  }

  takePendingToolResults(): AgentModelToolResultBlock[] {
    const results = this.pendingToolResultsValue;
    this.pendingToolResultsValue = [];
    return results;
  }

  commitToolResult(result: AgentModelToolResultBlock): void {
    const existingIndex = this.pendingToolResultsValue.findIndex(
      (item) => item.toolUseId === result.toolUseId,
    );
    if (existingIndex >= 0) this.pendingToolResultsValue[existingIndex] = result;
    else this.pendingToolResultsValue.push(result);
    this.activeToolUseValue = undefined;
    this.phaseValue = "tool_committed";
  }

  get activeToolUse(): AgentModelToolUseBlock | undefined {
    return this.activeToolUseValue;
  }

  claimTool(toolUse: AgentModelToolUseBlock): void {
    this.activeToolUseValue = structuredClone(toolUse);
    this.phaseValue = "tool_running";
  }

  clearActiveTool(): void {
    this.activeToolUseValue = undefined;
  }

  get phase(): DurableRunPhase {
    return this.phaseValue;
  }

  setPhase(phase: DurableRunPhase): void {
    this.phaseValue = phase;
  }

  get totalModelSteps(): number {
    return this.totalModelStepsValue;
  }

  get runModelSteps(): number {
    return this.runModelStepsValue;
  }

  beginModelStep(): number {
    const current = this.totalModelStepsValue;
    this.runModelStepsValue += 1;
    this.totalModelStepsValue += 1;
    this.phaseValue = "before_model";
    this.activeToolUseValue = undefined;
    return current;
  }

  get renderFeedbackUsed(): boolean {
    return this.renderFeedbackUsedValue;
  }

  markRenderFeedbackUsed(): void {
    this.renderFeedbackUsedValue = true;
  }

  get terminalState(): AgentTerminalState | undefined {
    return this.terminalStateValue;
  }

  setTerminalState(terminal: AgentTerminalState): void {
    if (this.terminalStateValue?.sealed) {
      throw new Error("Cannot replace a sealed AgentSession terminal state.");
    }
    this.terminalStateValue = terminal;
    this.phaseValue = "finished";
  }

  overrideTerminalCandidate(terminal: Omit<AgentTerminalState, "sealed">): void {
    if (this.terminalStateValue?.sealed) {
      throw new Error("Cannot override a sealed AgentSession terminal state.");
    }
    this.setTerminalState({ ...terminal, sealed: false });
  }

  sealTerminal(): void {
    if (!this.terminalStateValue) {
      throw new Error("Cannot seal AgentSession before a terminal candidate exists.");
    }
    this.terminalStateValue = { ...this.terminalStateValue, sealed: true };
  }

  apply(transition: AgentTransition): void {
    switch (transition.type) {
      case "model_input_prepared":
        this.beginModelStep();
        return;
      case "model_response_received":
        this.modelMessages.push({ role: "assistant", content: transition.content });
        if (transition.toolUses.length > 0) {
          this.queuedToolUses.push(...transition.toolUses);
          this.phaseValue = "model_committed";
        }
        return;
      case "tool_claimed":
        this.claimTool(transition.toolUse);
        return;
      case "tool_processed":
        this.commitToolResult(transition.result);
        return;
      case "run_terminal":
        this.setTerminalState({
          status: transition.status,
          result: transition.result,
          error: transition.error,
          sealed: false,
        });
        return;
    }
  }
}
