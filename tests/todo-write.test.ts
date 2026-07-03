import { describe, expect, it, vi } from "vitest";
import { todoWriteTool } from "../src/main/agent/tools/core/todo-write";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import {
  applyTodoUpdate,
  buildTodoReminder,
  summarizeTodoProgress,
  TODO_WRITE_REMINDER_THRESHOLD,
} from "../src/shared/agent-todo";
import {
  upsertTodoTrace,
  type AgentActivityItem,
} from "../src/shared/agent-activity";
import {
  AgentRuntime,
} from "../src/main/agent/runtime/agent-runtime";
import type { AgentModelGateway } from "../src/main/agent/gateway";
import { createStarterPresentation } from "../src/shared/presentation";

describe("TodoWrite tool", () => {
  it("registers as a core low-risk tool", () => {
    const registry = createDefaultToolRegistry();
    const tool = registry.get("TodoWrite");
    expect(tool?.category).toBe("core");
    expect(tool?.loadPolicy).toBe("core");
    expect(tool?.risk).toBe("low");
  });

  it("replaces the list when merge=false", () => {
    const current = [{ id: "a", content: "old", status: "pending" as const }];
    const next = applyTodoUpdate(current, false, [
      { id: "1", content: "step one", status: "pending" },
      { id: "2", content: "step two", status: "pending" },
    ]);
    expect(next).toHaveLength(2);
    expect(next[0]?.id).toBe("1");
  });

  it("merges by id when merge=true", () => {
    let current = applyTodoUpdate([], false, [
      { id: "1", content: "read deck", status: "pending" },
      { id: "2", content: "submit", status: "pending" },
    ]);
    current = applyTodoUpdate(current, true, [
      { id: "1", content: "read deck", status: "completed" },
      { id: "2", content: "submit", status: "in_progress" },
    ]);
    expect(current.find((item) => item.id === "1")?.status).toBe("completed");
    expect(current.find((item) => item.id === "2")?.status).toBe("in_progress");
  });

  it("stores todos in memory and notifies the UI", async () => {
    const onUpdated = vi.fn();
    const items: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" | "cancelled" }> = [];

    const result = await todoWriteTool.execute(
      {
        merge: false,
        todos: [{ id: "1", content: "Plan slides", status: "pending" }],
      },
      {
        presentation: createStarterPresentation(),
        selectedElementIds: [],
        discoverySession: { discoveredToolNames: new Set() },
        registry: createDefaultToolRegistry(),
        messageHistory: [],
        todoSession: {
          getItems: () => items,
          applyUpdate: (merge, todos) => {
            const next = applyTodoUpdate(items, merge, todos);
            items.splice(0, items.length, ...next);
            return next;
          },
        },
        notifyTodoUpdated: onUpdated,
      },
    );

    expect(result.summary).toContain("0/1");
    expect(items).toHaveLength(1);
    expect(onUpdated).toHaveBeenCalledWith(items);
  });

  it("builds a reminder after threshold rounds without TodoWrite", () => {
    const reminder = buildTodoReminder([
      { id: "1", content: "Create outline", status: "completed" },
      { id: "2", content: "Build slides", status: "in_progress" },
    ]);
    expect(reminder).toContain("连续 3 轮");
    expect(reminder).toContain("Create outline");
    expect(summarizeTodoProgress([
      { id: "1", content: "a", status: "completed" },
      { id: "2", content: "b", status: "pending" },
    ])).toBe("1/2 已完成 · 1 项待办");
    expect(TODO_WRITE_REMINDER_THRESHOLD).toBe(3);
  });

  it("upserts a single todo block in the activity trace", () => {
    let trace: AgentActivityItem[] = [];
    trace = upsertTodoTrace(trace, [{ id: "1", content: "a", status: "pending" }]);
    trace = upsertTodoTrace(trace, [
      { id: "1", content: "a", status: "completed" },
      { id: "2", content: "b", status: "pending" },
    ]);
    expect(trace.filter((item) => item.kind === "todo")).toHaveLength(1);
    expect(trace[0]?.kind === "todo" && trace[0].todos).toHaveLength(2);
  });
});

function createSequenceGateway(responses: unknown[]): AgentModelGateway {
  let index = 0;
  return {
    async generateText() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      return {
        provider: "openai",
        model: "test-model",
        text: typeof value === "string" ? value : JSON.stringify(value),
      };
    },
    async *generateTextStream() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      const text = typeof value === "string" ? value : JSON.stringify(value);
      yield { type: "content" as const, text };
      yield { type: "complete" as const, text: "" };
    },
  };
}

describe("AgentRuntime todo reminder", () => {
  it("appends a reminder on the 4th LLM round without TodoWrite", async () => {
    const registry = createDefaultToolRegistry();
    const gateway = createSequenceGateway([
      { type: "tool_call", toolName: "ReadPresentationSnapshot", args: {} },
      { type: "tool_call", toolName: "ListSlides", args: {} },
      { type: "tool_call", toolName: "GetSelection", args: { includeElements: false } },
      { type: "message", content: "done after reminder" },
    ]);

    const prompts: string[] = [];
    const wrappedGateway: AgentModelGateway = {
      async generateText(input) {
        prompts.push(input.prompt);
        return gateway.generateText(input);
      },
      generateTextStream: gateway.generateTextStream.bind(gateway),
    };

    const runtime = new AgentRuntime(registry, wrappedGateway);
    const result = await runtime.run({
      threadId: "todo-reminder-test",
      request: "update my deck",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      maxSteps: 6,
    });

    expect(result.type).toBe("message");
    expect(prompts).toHaveLength(4);
    const fourthPrompt = JSON.parse(prompts[3]!);
    const reminders = fourthPrompt.transcript.filter(
      (entry: { role?: string }) => entry.role === "reminder",
    );
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders[0].content).toContain("连续 3 轮");
  });

  it("resets reminder counter after TodoWrite", async () => {
    const registry = createDefaultToolRegistry();
    const gateway = createSequenceGateway([
      { type: "tool_call", toolName: "ReadPresentationSnapshot", args: {} },
      { type: "tool_call", toolName: "ListSlides", args: {} },
      {
        type: "tool_call",
        toolName: "TodoWrite",
        args: {
          merge: false,
          todos: [{ id: "1", content: "finish deck", status: "in_progress" }],
        },
      },
      { type: "tool_call", toolName: "GetSelection", args: { includeElements: false } },
      { type: "message", content: "ok" },
    ]);

    const prompts: string[] = [];
    const wrappedGateway: AgentModelGateway = {
      async generateText(input) {
        prompts.push(input.prompt);
        return gateway.generateText(input);
      },
      generateTextStream: gateway.generateTextStream.bind(gateway),
    };

    const runtime = new AgentRuntime(registry, wrappedGateway);
    await runtime.run({
      threadId: "todo-reset-test",
      request: "update my deck",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      maxSteps: 8,
    });

    const fifthPrompt = JSON.parse(prompts[4]!);
    const reminders = fifthPrompt.transcript.filter(
      (entry: { role?: string }) => entry.role === "reminder",
    );
    expect(reminders).toHaveLength(0);
  });
});
