import type { AgentTodoItem } from "@shared/agent-todo";

/** Per-thread in-memory todo plan and reminder counter for one agent run. */
export interface TodoRunState {
  items: AgentTodoItem[];
  roundsSinceWrite: number;
}

export function createTodoRunState(): TodoRunState {
  return {
    items: [],
    roundsSinceWrite: 0,
  };
}
