import type { AgentModelToolResultBlock } from "../../gateway/types";
import type { AgentSession } from "../lifecycle/agent-session";

/** Maintains the provider-required assistant/tool_result adjacency for user turns. */
export class TurnInputAssembler {
  constructor(private readonly session: AgentSession) {}

  append(input: { text?: string; toolResults?: AgentModelToolResultBlock[] }): void {
    this.session.appendUserTurn(input);
  }
}
