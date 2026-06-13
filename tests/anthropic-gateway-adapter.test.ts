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
      maxRetries: 2,
    });
    expect(anthropicMock.create).toHaveBeenCalledWith({
      model: "anthropic-test",
      max_tokens: 654,
      system: "System instruction",
      messages: [{ role: "user", content: "User prompt" }],
    });
    expect(response).toEqual({
      provider: "anthropic",
      model: "anthropic-test",
      text: "first\nsecond",
      requestId: "req-anthropic",
      stopReason: "end_turn",
    });
  });

  it("rejects a response without text content", async () => {
    anthropicMock.create.mockResolvedValue({
      content: [{ type: "thinking", thinking: "hidden" }],
      _request_id: null,
      stop_reason: "end_turn",
    });

    await expect(generateWithAnthropic(config, { prompt: "User prompt" })).rejects.toMatchObject({
      code: "empty-response",
      provider: "anthropic",
    });
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
