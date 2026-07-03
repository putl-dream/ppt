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
      text: "first\nsecond",
      requestId: "req-anthropic",
      stopReason: "end_turn",
    });
  });

  it("retries with a larger output budget when thinking consumes the response", async () => {
    anthropicMock.create
      .mockResolvedValueOnce({
        content: [{ type: "thinking", thinking: "hidden" }],
        _request_id: null,
        stop_reason: "max_tokens",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "final answer" }],
        _request_id: "req-retry",
        stop_reason: "end_turn",
      });

    const response = await generateWithAnthropic(config, { prompt: "User prompt" });

    expect(anthropicMock.create).toHaveBeenCalledTimes(2);
    expect(anthropicMock.create.mock.calls[1][0]).toMatchObject({ max_tokens: 1308 });
    expect(response.text).toBe("final answer");
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

    expect(response.text).toBe("compatible response");
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
