import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { readPresentationSnapshotTool } from "../src/main/agent/tools/core/read-presentation-snapshot";
import { listSlidesTool } from "../src/main/agent/tools/core/list-slides";
import { submitCommandsTool } from "../src/main/agent/tools/core/submit-commands";
import { toToolSchema } from "../src/main/agent/tools/tool-schema";
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelToolCall,
} from "../src/main/agent/gateway/types";
import { createStarterPresentation } from "../src/shared/presentation";

/**
 * Gateway mock that declares native tool-use support and replays a scripted
 * sequence of structured tool calls (instead of text JSON).
 */
function createNativeGateway(
  turns: Array<{ text?: string; toolCalls?: AgentModelToolCall[] }>,
): AgentModelGateway & { requests: AgentModelRequest[] } {
  let index = 0;
  const requests: AgentModelRequest[] = [];
  return {
    requests,
    supportsNativeToolUse() {
      return true;
    },
    async generateText(request): Promise<AgentModelResponse> {
      requests.push(request);
      const turn = turns[index++];
      if (!turn) throw new Error("Unexpected gateway call");
      return {
        provider: "anthropic",
        model: "test-model",
        text: turn.text ?? "",
        toolCalls: turn.toolCalls,
      };
    },
    async *generateTextStream(request) {
      requests.push(request);
      const turn = turns[index++];
      if (!turn) throw new Error("Unexpected gateway call");
      if (turn.text) {
        yield { type: "content" as const, text: turn.text };
      }
      yield { type: "complete" as const, text: "", toolCalls: turn.toolCalls };
    },
  };
}

function textEnvelope(content: string): string {
  return JSON.stringify({
    kind: "text",
    format: "markdown",
    type: "assistant.message",
    data: { content },
  });
}

describe("native tool-use runtime path", () => {
  it("converts a zod tool schema to a JSON Schema tool spec", () => {
    const spec = toToolSchema(submitCommandsTool);
    expect(spec.name).toBe("SubmitCommands");
    expect(spec.inputSchema.type).toBe("object");
    const properties = spec.inputSchema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("summary");
    expect(properties).toHaveProperty("commands");
  });

  it("drives a tool loop from structured toolCalls and passes tools to the gateway", async () => {
    const registry = new ToolRegistry();
    registry.register(readPresentationSnapshotTool);
    registry.register(submitCommandsTool);

    const gateway = createNativeGateway([
      {
        toolCalls: [{ id: "call-1", name: "ReadPresentationSnapshot", args: {} }],
      },
      {
        toolCalls: [{
          id: "call-2",
          name: "SubmitCommands",
          args: {
            summary: "Set title",
            commands: [{ id: "cmd-1", type: "set-presentation-title", title: "Native title" }],
            risk: "low",
          },
        }],
      },
    ]);

    const runtime = new AgentRuntime(registry, gateway);
    const result = await runtime.run({
      threadId: "native-thread",
      request: "Create a title",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result.type).toBe("deck.command_proposal");
    expect(result.kind).toBe("structured");
    expect(result.format).toBe("json");
    if (result.type === "deck.command_proposal") {
      expect(result.data.commands[0].type).toBe("set-presentation-title");
    }

    // Every request carried native tool specs.
    expect(gateway.requests.length).toBe(2);
    for (const request of gateway.requests) {
      expect(request.tools?.some((tool) => tool.name === "SubmitCommands")).toBe(true);
      expect(request.messages?.length).toBeGreaterThan(0);
    }

    // The second request echoed the first tool_use + its tool_result.
    const secondMessages = gateway.requests[1]!.messages!;
    const assistantTurn = secondMessages.find((message) => message.role === "assistant");
    expect(assistantTurn?.toolCalls?.[0]?.name).toBe("ReadPresentationSnapshot");
    const toolResultTurn = secondMessages.find((message) => message.toolResults?.length);
    expect(toolResultTurn?.toolResults?.[0]?.toolCallId).toBe("call-1");
  });

  it("returns an assistant.message envelope when the model responds without tool calls", async () => {
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);

    const gateway = createNativeGateway([
      { text: textEnvelope("已完成，无需修改幻灯片。") },
    ]);

    const runtime = new AgentRuntime(registry, gateway);
    const result = await runtime.run({
      threadId: "native-message-thread",
      request: "解释一下当前进度",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result.type).toBe("assistant.message");
    expect(result.kind).toBe("text");
    expect(result.format).toBe("markdown");
    if (result.type === "assistant.message") {
      expect(result.data.content).toContain("已完成");
    }
  });

  it("streams content from assistant.message envelopes on the native no-tool path", async () => {
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);

    const gateway = createNativeGateway([
      { text: textEnvelope("我是你的 PPT 智能助手。\n\n说说你的需求，我马上开干。") },
    ]);
    let streamed = "";

    const runtime = new AgentRuntime(registry, gateway);
    const result = await runtime.run({
      threadId: "native-json-message-thread",
      request: "你是谁？",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      onStreamChunk: (chunk) => {
        streamed += chunk;
      },
    });

    expect(result.type).toBe("assistant.message");
    expect(result.kind).toBe("text");
    expect(result.format).toBe("markdown");
    if (result.type === "assistant.message") {
      expect(result.data.content).toBe("我是你的 PPT 智能助手。\n\n说说你的需求，我马上开干。");
    }
    expect(streamed).toBe("我是你的 PPT 智能助手。\n\n说说你的需求，我马上开干。");
    expect(streamed).not.toContain('"type"');
  });

  it("retries direct markdown assistant text on the native no-tool path", async () => {
    const registry = new ToolRegistry();
    registry.register(submitCommandsTool);

    const gateway = createNativeGateway([
      { text: "**可以。** 先讲概念，再决定是否制作 PPT。" },
      { text: textEnvelope("**可以。** 先讲概念，再决定是否制作 PPT。") },
    ]);
    let streamed = "";

    const runtime = new AgentRuntime(registry, gateway);
    const result = await runtime.run({
      threadId: "native-markdown-message-thread",
      request: "先不做 PPT，解释一下这个概念",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      onStreamChunk: (chunk) => {
        streamed += chunk;
      },
    });

    expect(result).toEqual({
      kind: "text",
      format: "markdown",
      type: "assistant.message",
      data: { content: "**可以。** 先讲概念，再决定是否制作 PPT。" },
    });
    expect(streamed).toBe("**可以。** 先讲概念，再决定是否制作 PPT。");
    expect(gateway.requests).toHaveLength(2);
  });

  it("executes every tool_use in one assistant turn and returns one paired result batch", async () => {
    const registry = new ToolRegistry();
    registry.register(readPresentationSnapshotTool);
    registry.register(listSlidesTool);

    const gateway = createNativeGateway([
      {
        toolCalls: [
          { id: "call-read", name: "ReadPresentationSnapshot", args: {} },
          { id: "call-list", name: "ListSlides", args: {} },
        ],
      },
      { text: textEnvelope("两个只读工具均已执行。") },
    ]);

    const runtime = new AgentRuntime(registry, gateway);
    const result = await runtime.run({
      threadId: "native-batch-thread",
      request: "读取当前演示文稿",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result.type).toBe("assistant.message");
    expect(gateway.requests).toHaveLength(2);
    const secondMessages = gateway.requests[1]!.messages!;
    const assistantTurn = secondMessages.find((message) => message.toolCalls?.length);
    expect(assistantTurn?.toolCalls?.map((call) => call.id)).toEqual(["call-read", "call-list"]);
    const resultTurn = secondMessages.find((message) => message.toolResults?.length);
    expect(resultTurn?.toolResults?.map((item) => item.toolCallId)).toEqual([
      "call-read",
      "call-list",
    ]);
    expect(resultTurn?.toolResults?.every((item) => item.isError !== true)).toBe(true);
  });

  it("rejects text tool.call envelopes in native mode because they have no provider call ID", async () => {
    const registry = new ToolRegistry();
    registry.register(listSlidesTool);

    const gateway = createNativeGateway([
      {
        text: JSON.stringify({
          kind: "structured",
          format: "json",
          type: "tool.call",
          data: { toolName: "ListSlides", args: {} },
        }),
      },
      { text: textEnvelope("已改用正确的原生工具协议。") },
    ]);

    const runtime = new AgentRuntime(registry, gateway);
    const result = await runtime.run({
      threadId: "native-text-tool-call-thread",
      request: "读取页面",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result.type).toBe("assistant.message");
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[1]?.messages?.at(-1)?.content).toContain(
      "requires a provider tool_use block",
    );
  });
});
