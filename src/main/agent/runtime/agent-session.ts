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
 * Recoverable collections expose read-only views. Collaborators update them
 * through explicit Session commands or AgentTransition values so checkpoint
 * snapshots never depend on scattered mutable aliases.
 */
export class AgentSession {
  private readonly transcriptValue: Array<Record<string, unknown>>;
  private readonly modelMessagesValue: AgentModelMessage[];
  private readonly queuedToolUsesValue: AgentModelToolUseBlock[];
  private readonly pendingUserContentValue: string[];
  private readonly processedInboxMessageIdsValue: Set<string>;
  private readonly validationFailuresByToolValue = new Map<string, number>();
  private pendingToolResultsValue: AgentModelToolResultBlock[];
  private activeToolUseValue?: AgentModelToolUseBlock;
  private phaseValue: DurableRunPhase;
  private totalModelStepsValue: number;
  private runModelStepsValue = 0;
  private renderFeedbackUsedValue: boolean;
  private terminalStateValue?: AgentTerminalState;

  constructor(input: AgentSessionInput) {
    this.transcriptValue = input.transcript;
    this.modelMessagesValue = input.modelMessages;
    this.queuedToolUsesValue = input.queuedToolUses ?? [];
    this.pendingToolResultsValue = input.pendingToolResults ?? [];
    this.pendingUserContentValue = input.pendingUserContent ?? [];
    this.processedInboxMessageIdsValue = new Set(input.processedInboxMessageIds ?? []);
    this.activeToolUseValue = input.activeToolUse;
    this.phaseValue = input.phase ?? "before_model";
    this.totalModelStepsValue = input.totalModelSteps ?? 0;
    this.renderFeedbackUsedValue = input.renderFeedbackUsed ?? false;
  }

  get transcript(): readonly Record<string, unknown>[] {
    return this.transcriptValue;
  }

  appendTranscript(entry: Record<string, unknown>): void {
    this.transcriptValue.push(entry);
  }

  get modelMessages(): readonly AgentModelMessage[] {
    return this.modelMessagesValue;
  }

  appendUserTurn(input: {
    text?: string;
    toolResults?: readonly AgentModelToolResultBlock[];
  }): void {
    const text = input.text?.trim();
    const toolResults = input.toolResults?.length ? input.toolResults : undefined;
    if (!toolResults && !text) return;

    if (!toolResults && text) {
      const last = this.modelMessagesValue.at(-1);
      if (last?.role === "user" && !last.content.some((block) => block.type === "tool_result")) {
        last.content.push({ type: "text", text });
        return;
      }
    }
    this.modelMessagesValue.push({
      role: "user",
      content: [
        ...(toolResults ?? []),
        ...(text ? [{ type: "text" as const, text }] : []),
      ],
    });
  }

  get queuedToolUses(): readonly AgentModelToolUseBlock[] {
    return this.queuedToolUsesValue;
  }

  takeQueuedToolUse(): AgentModelToolUseBlock | undefined {
    return this.queuedToolUsesValue.shift();
  }

  hasQueuedToolUses(): boolean {
    return this.queuedToolUsesValue.length > 0;
  }

  get pendingUserContent(): readonly string[] {
    return this.pendingUserContentValue;
  }

  appendPendingUserContent(content: string): void {
    if (content) this.pendingUserContentValue.push(content);
  }

  takePendingUserContent(): string[] {
    return this.pendingUserContentValue.splice(0);
  }

  get processedInboxMessageIds(): ReadonlySet<string> {
    return this.processedInboxMessageIdsValue;
  }

  hasProcessedInboxMessage(id: string): boolean {
    return this.processedInboxMessageIdsValue.has(id);
  }

  recordInboxConsumption(
    ids: readonly string[],
    transcriptEntry: Record<string, unknown>,
  ): void {
    this.transcriptValue.push(transcriptEntry);
    for (const id of ids) this.processedInboxMessageIdsValue.add(id);
  }

  recordValidationFailure(toolName: string): number {
    const failures = (this.validationFailuresByToolValue.get(toolName) ?? 0) + 1;
    this.validationFailuresByToolValue.set(toolName, failures);
    return failures;
  }

  get pendingToolResults(): readonly AgentModelToolResultBlock[] {
    return this.pendingToolResultsValue;
  }

  replacePendingToolResults(results: readonly AgentModelToolResultBlock[]): void {
    this.pendingToolResultsValue = [...results];
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
        this.modelMessagesValue.push({ role: "assistant", content: transition.content });
        if (transition.toolUses.length > 0) {
          this.queuedToolUsesValue.push(...transition.toolUses);
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
