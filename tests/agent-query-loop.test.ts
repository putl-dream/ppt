import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import type {
  AgentModelContentBlock,
  AgentModelGateway,
  AgentModelRequest,
} from "../src/main/agent/gateway/types";
import type { ToolDefinition } from "../src/main/agent/tools/tool-definition";
import { createStarterPresentation } from "../src/shared/presentation";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableRunStore } from "../src/main/agent/persistence/durable-run-store";

function gatewayFor(turns: AgentModelContentBlock[][]): AgentModelGateway & {
  requests: AgentModelRequest[];
} {
  const requests: AgentModelRequest[] = [];
  let index = 0;
  return {
    requests,
    async generateText(request) {
      requests.push(request);
      const content = turns[index++];
      if (!content) throw new Error("Unexpected gateway call");
      return { provider: "openai", model: "test", content };
    },
    async *generateTextStream(request) {
      const response = await this.generateText(request);
      yield { type: "complete" as const, content: response.content };
    },
  };
}

function countingTool(onExecute: () => void): ToolDefinition<any, any> {
  return {
    name: "CountingTool",
    description: "Counts executions.",
    category: "core",
    loadPolicy: "core",
    inputSchema: z.object({ value: z.number() }),
    outputSchema: z.object({ ok: z.literal(true) }),
    risk: "low",
    async execute() {
      onExecute();
      return { ok: true };
    },
  };
}

describe("agent query loop batches", () => {
  it("rejects a mixed terminal batch as one complete error result turn", async () => {
    let executions = 0;
    const registry = new ToolRegistry();
    registry.register(askUserTool);
    registry.register(countingTool(() => { executions += 1; }));
    const gateway = gatewayFor([
      [
        {
          type: "tool_use",
          id: "ask",
          name: "AskUser",
          input: { message: "clarify" },
        },
        {
          type: "tool_use",
          id: "count",
          name: "CountingTool",
          input: { value: 1 },
        },
      ],
      [{ type: "text", text: "retried with a valid batch" }],
    ]);

    const result = await new AgentRuntime(registry, gateway).run({
      threadId: "mixed-terminal-batch",
      request: "run",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result).toEqual({ type: "message", content: "retried with a valid batch" });
    expect(executions).toBe(0);
    const resultTurns = gateway.requests[1]!.messages!.filter((message) =>
      message.role === "user"
      && message.content.some((block) => block.type === "tool_result")
    );
    expect(resultTurns).toHaveLength(1);
    expect(resultTurns[0]!.content).toEqual([
      expect.objectContaining({ type: "tool_result", toolUseId: "ask", isError: true }),
      expect.objectContaining({ type: "tool_result", toolUseId: "count", isError: true }),
    ]);
  });

  it("counts a complete multi-tool batch as one agentic turn", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-query-batch-"));
    let executions = 0;
    const registry = new ToolRegistry();
    registry.register(countingTool(() => { executions += 1; }));
    const gateway = gatewayFor([[
      { type: "tool_use", id: "count-1", name: "CountingTool", input: { value: 1 } },
      { type: "tool_use", id: "count-2", name: "CountingTool", input: { value: 2 } },
    ]]);

    const result = await new AgentRuntime(registry, gateway).run({
      threadId: "batch-turn-limit",
      request: "run twice",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      maxSteps: 1,
      workspaceRoot,
    });

    expect(result.type).toBe("message");
    expect(executions).toBe(2);
    expect(gateway.requests).toHaveLength(1);
    const checkpoint = await new DurableRunStore(workspaceRoot).load("batch-turn-limit");
    expect(checkpoint?.queryLifecycle).toMatchObject({
      committedState: { turnCount: 1 },
    });
    expect(checkpoint?.queryLifecycle?.inflight).toBeUndefined();
  });
});
