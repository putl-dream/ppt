import type {
  AgentModelContentBlock,
  AgentModelThinkingBlock,
  AgentModelToolCall,
} from "./types";

export function textFromContentBlocks(blocks: AgentModelContentBlock[] | undefined): string {
  return (blocks ?? [])
    .filter((block): block is Extract<AgentModelContentBlock, { type: "text" }> =>
      block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function toolCallsFromContentBlocks(
  blocks: AgentModelContentBlock[] | undefined,
): AgentModelToolCall[] {
  return (blocks ?? [])
    .filter((block): block is Extract<AgentModelContentBlock, { type: "tool_use" }> =>
      block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      args: block.input,
      ...(block.parseError ? { parseError: block.parseError } : {}),
    }));
}

export function thinkingFromContentBlocks(
  blocks: AgentModelContentBlock[] | undefined,
): AgentModelThinkingBlock[] {
  return (blocks ?? []).filter(
    (block): block is AgentModelThinkingBlock =>
      block.type === "thinking" || block.type === "redacted_thinking",
  );
}

