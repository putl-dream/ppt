import type { AgentModelMessage, AgentModelToolResultBlock } from "../gateway/types";

/** Maintains the provider-required assistant/tool_result adjacency for user turns. */
export class TurnInputAssembler {
  constructor(private readonly modelMessages: AgentModelMessage[]) {}

  append(input: { text?: string; toolResults?: AgentModelToolResultBlock[] }): void {
    const text = input.text?.trim();
    const toolResults = input.toolResults?.length ? input.toolResults : undefined;
    if (!toolResults && !text) return;

    if (!toolResults && text) {
      const last = this.modelMessages.at(-1);
      if (last?.role === "user" && !last.content.some((block) => block.type === "tool_result")) {
        last.content.push({ type: "text", text });
        return;
      }
    }

    this.modelMessages.push({
      role: "user",
      content: [
        ...(toolResults ?? []),
        ...(text ? [{ type: "text" as const, text }] : []),
      ],
    });
  }
}
