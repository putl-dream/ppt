import { describe, expect, it, vi } from "vitest";
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
  it("passes stable query context and output-token policy to the gateway", async () => {
    const gateway = gatewayFor([[{ type: "text", text: "done" }]]);

    await new AgentRuntime(new ToolRegistry(), gateway).run({
      threadId: "query-policy",
      runId: "query-policy-run",
      request: "inspect",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      userContext: { locale: "zh-CN" },
      systemContext: { surface: "desktop" },
      maxOutputTokensOverride: 12_345,
    });

    expect(gateway.requests[0]?.maxOutputTokens).toBe(12_345);
    expect(JSON.parse(gateway.requests[0]!.prompt)).toEqual({
      transcript: [],
      queryContext: {
        source: "user",
        user: { locale: "zh-CN" },
        system: {
          surface: "desktop",
          threadId: "query-policy",
          runId: "query-policy-run",
        },
      },
    });
  });

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
    expect(checkpoint).toMatchObject({
      version: 2,
      committedState: { turnCount: 1 },
    });
    expect(checkpoint?.version === 2 ? checkpoint.inflight : undefined).toBeUndefined();
  });

  it("checkpoints a completed tool result before committing the next State", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-tool-result-checkpoint-"));
    const checkpoints: Parameters<DurableRunStore["saveCas"]>[0]["checkpoint"][] = [];
    const originalSaveCas = DurableRunStore.prototype.saveCas;
    const saveSpy = vi.spyOn(DurableRunStore.prototype, "saveCas")
      .mockImplementation(async function (this: DurableRunStore, input) {
        checkpoints.push(structuredClone(input.checkpoint));
        return await originalSaveCas.call(this, input);
      });
    try {
      const registry = new ToolRegistry();
      registry.register(countingTool(() => undefined));
      const gateway = gatewayFor([
        [{ type: "tool_use", id: "durable-result", name: "CountingTool", input: { value: 1 } }],
        [{ type: "text", text: "done" }],
      ]);

      await new AgentRuntime(registry, gateway).run({
        threadId: "durable-tool-result",
        request: "run once",
        presentationSnapshot: createStarterPresentation(),
        selectedElementIds: [],
        workspaceRoot,
      });
    } finally {
      saveSpy.mockRestore();
    }

    expect(checkpoints.some((checkpoint) =>
      checkpoint.version === 2
      && checkpoint.status === "running"
      && checkpoint.inflight?.phase === "model_received"
      && checkpoint.inflight.workspace.toolResults.some((result) =>
        result.toolUseId === "durable-result")
    )).toBe(true);
  });

  it("assembles canUseTool from the tools exposed to this query", async () => {
    let executions = 0;
    const registry = new ToolRegistry();
    registry.register({
      ...countingTool(() => { executions += 1; }),
      name: "DeferredCountingTool",
      category: "deferred",
      loadPolicy: "deferred",
    });
    const gateway = gatewayFor([
      [{
        type: "tool_use",
        id: "deferred-direct",
        name: "DeferredCountingTool",
        input: { value: 1 },
      }],
      [{ type: "text", text: "used the available tool boundary" }],
    ]);

    await new AgentRuntime(registry, gateway).run({
      threadId: "query-tool-boundary",
      request: "call a deferred tool directly",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(executions).toBe(0);
    expect(gateway.requests[1]!.messages!.flatMap((message) => message.content))
      .toContainEqual(expect.objectContaining({
        type: "tool_result",
        toolUseId: "deferred-direct",
        isError: true,
        content: [expect.objectContaining({
          type: "text",
          text: expect.stringContaining("not permitted in this query"),
        })],
      }));
  });
});
