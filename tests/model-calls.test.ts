import { describe, expect, it, vi } from "vitest";
import type {
  AgentModelContentBlock,
  AgentModelGateway,
  AgentModelRequest,
  StopReason,
} from "../src/main/agent/gateway";
import {
  callLLM,
  callTool,
  ModelOutputError,
} from "../src/main/agent/gateway";

function createGateway(
  content: AgentModelContentBlock[],
  stopReason?: StopReason,
) {
  const requests: AgentModelRequest[] = [];
  const generateText = vi.fn(async (request: AgentModelRequest) => {
    requests.push(request);
    return {
      provider: "openai" as const,
      model: "test-model",
      content,
      stopReason,
    };
  });
  const gateway: AgentModelGateway = {
    generateText,
    async *generateTextStream() {
      yield { type: "complete" as const, content };
    },
  };
  return { gateway, requests, generateText };
}

describe("typed model calls", () => {
  it("callLLM returns Markdown and applies the Markdown response contract", async () => {
    const { gateway, requests } = createGateway([
      { type: "text", text: "# Result\n\nDone." },
    ]);

    await expect(callLLM(gateway, { prompt: "Summarize" })).resolves.toBe(
      "# Result\n\nDone.",
    );
    expect(requests[0]).toMatchObject({
      prompt: "Summarize",
      responseContract: "markdown",
    });
    expect(requests[0]?.tools).toBeUndefined();
  });

  it("callLLM rejects a tool call instead of silently returning adjacent text", async () => {
    const { gateway } = createGateway([
      { type: "text", text: "Checking..." },
      { type: "tool_use", id: "call-1", name: "Read", input: {} },
    ]);

    await expect(callLLM(gateway, { prompt: "Read" })).rejects.toMatchObject({
      name: "ModelOutputError",
      code: "unexpected-tool-use",
    });
  });

  it("callLLM rejects non-empty Markdown when the provider reports truncation", async () => {
    const { gateway } = createGateway(
      [{ type: "text", text: "A plausible but incomplete summary." }],
      "max_tokens",
    );

    await expect(callLLM(gateway, {
      prompt: "Summarize",
      responseContract: "markdown-summary",
    })).rejects.toMatchObject({
      name: "ModelOutputError",
      code: "truncated-output",
    });
  });

  it("callTool classifies native tool calls and preserves accompanying Markdown", async () => {
    const { gateway } = createGateway([
      { type: "text", text: "I will inspect the deck." },
      { type: "tool_use", id: "call-1", name: "Read", input: { slide: 1 } },
    ]);

    const turn = await callTool(gateway, {
      prompt: "Inspect slide one",
      tools: [{
        name: "Read",
        description: "Read a slide",
        inputSchema: { type: "object", properties: { slide: { type: "number" } } },
      }],
    });

    expect(turn).toMatchObject({
      type: "tool_calls",
      markdown: "I will inspect the deck.",
      calls: [{ id: "call-1", name: "Read", input: { slide: 1 } }],
    });
  });

  it("callTool returns a distinct final Markdown turn when no tool is selected", async () => {
    const { gateway } = createGateway([{ type: "text", text: "No changes needed." }]);

    const turn = await callTool(gateway, {
      prompt: "Inspect",
      tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
    });

    expect(turn).toMatchObject({ type: "final", markdown: "No changes needed." });
  });

  it("callTool requires an explicit non-empty tool set", async () => {
    const { gateway, generateText } = createGateway([{ type: "text", text: "unused" }]);

    await expect(callTool(gateway, { prompt: "Inspect", tools: [] })).rejects.toMatchObject({
      code: "missing-tools",
    });
    expect(generateText).not.toHaveBeenCalled();
  });
});
