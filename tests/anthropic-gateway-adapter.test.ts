import { beforeEach, describe, expect, it, vi } from "vitest";

const anthropicMock = vi.hoisted(() => ({
  constructorOptions: undefined as unknown,
  create: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: anthropicMock.create };

    constructor(options: unknown) {
      anthropicMock.constructorOptions = options;
    }
  },
}));

import { generateWithAnthropic } from "../src/main/agent/gateway/anthropic";

const config = {
  provider: "anthropic" as const,
  model: "anthropic-test",
  apiKey: "secret",
  baseURL: "https://anthropic.example.test",
  timeoutMs: 2345,
  maxOutputTokens: 654,
};

describe("generateWithAnthropic", () => {
  beforeEach(() => {
    anthropicMock.create.mockReset();
    anthropicMock.constructorOptions = undefined;
  });

  it("calls the Messages API and joins text content blocks", async () => {
    anthropicMock.create.mockResolvedValue({
      content: [
        { type: "text", text: "first" },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "second" },
      ],
      _request_id: "req-anthropic",
      stop_reason: "end_turn",
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        cache_read_input_tokens: 25,
        cache_creation_input_tokens: 5,
      },
    });

    const response = await generateWithAnthropic(config, {
      systemPrompt: "System instruction",
      prompt: "User prompt",
    });

    expect(anthropicMock.constructorOptions).toEqual({
      apiKey: "secret",
      baseURL: "https://anthropic.example.test",
      timeout: 2345,
      maxRetries: 0,
    });
    expect(anthropicMock.create).toHaveBeenCalledWith({
      model: "anthropic-test",
      max_tokens: 654,
      system: "System instruction",
      messages: [{ role: "user", content: "User prompt" }],
    }, { signal: undefined });
    expect(response).toEqual({
      provider: "anthropic",
      model: "anthropic-test",
      content: [
        { type: "text", text: "first" },
        { type: "thinking", thinking: "hidden", signature: "" },
        { type: "text", text: "second" },
      ],
      requestId: "req-anthropic",
      stopReason: "end_turn",
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 170,
        cachedInputTokens: 25,
        cacheCreationInputTokens: 5,
      },
    });
  });

  it("passes JSON Schema output contracts to the Messages API", async () => {
    anthropicMock.create.mockResolvedValue({
      content: [{ type: "text", text: '{"title":"Deck"}' }],
      _request_id: "req-json",
      stop_reason: "end_turn",
    });

    await generateWithAnthropic(config, {
      prompt: "Return metadata",
      outputFormat: {
        type: "json_schema",
        name: "deck_metadata",
        schema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
        strict: true,
      },
    });

    expect(anthropicMock.create.mock.calls[0]?.[0]).toMatchObject({
      output_config: {
        format: {
          type: "json_schema",
          schema: { type: "object", required: ["title"] },
        },
      },
    });
  });

  it("keeps named one-shot tools compatible with thinking mode", async () => {
    anthropicMock.create.mockResolvedValue({
      content: [{
        type: "tool_use",
        id: "tool-1",
        name: "submit_deck",
        input: { title: "Deck" },
      }],
      _request_id: "req-tool",
      stop_reason: "tool_use",
    });

    await generateWithAnthropic(config, {
      prompt: "Submit the deck",
      tools: [{
        name: "submit_deck",
        description: "Submit a deck",
        inputSchema: { type: "object", properties: { title: { type: "string" } } },
      }],
      requiredToolName: "submit_deck",
    });

    expect(anthropicMock.create.mock.calls[0]?.[0]).toMatchObject({
      tools: [{ name: "submit_deck" }],
    });
    expect(anthropicMock.create.mock.calls[0]?.[0]).not.toHaveProperty("tool_choice");
  });

  it("retries with a larger output budget when thinking consumes the response", async () => {
    anthropicMock.create
      .mockResolvedValueOnce({
        content: [{ type: "thinking", thinking: "hidden" }],
        _request_id: null,
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 20 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "final answer" }],
        _request_id: "req-retry",
        stop_reason: "end_turn",
        usage: { input_tokens: 30, output_tokens: 40 },
      });

    const response = await generateWithAnthropic(config, { prompt: "User prompt" });

    expect(anthropicMock.create).toHaveBeenCalledTimes(2);
    expect(anthropicMock.create.mock.calls[1][0]).toMatchObject({ max_tokens: 1308 });
    expect(response.content).toEqual([{ type: "text", text: "final answer" }]);
    expect(response.usage).toEqual({
      inputTokens: 40,
      outputTokens: 60,
      totalTokens: 100,
    });
  });

  it("rejects a response without any usable content", async () => {
    anthropicMock.create.mockResolvedValue({
      content: [],
      _request_id: null,
      stop_reason: "end_turn",
    });

    await expect(generateWithAnthropic(config, { prompt: "User prompt" })).rejects.toMatchObject({
      code: "empty-response",
      provider: "anthropic",
    });
  });

  it("accepts a string content field from a compatible endpoint", async () => {
    anthropicMock.create.mockResolvedValue({
      content: "compatible response",
      _request_id: "req-compatible",
      stop_reason: "end_turn",
    });

    const response = await generateWithAnthropic(config, { prompt: "User prompt" });

    expect(response.content).toEqual([{ type: "text", text: "compatible response" }]);
  });

  it("normalizes provider rate-limit errors", async () => {
    anthropicMock.create.mockRejectedValue(
      Object.assign(new Error("slow down"), { status: 429 }),
    );

    await expect(generateWithAnthropic(config, { prompt: "User prompt" })).rejects.toMatchObject({
      code: "rate-limit",
      provider: "anthropic",
    });
  });
});
