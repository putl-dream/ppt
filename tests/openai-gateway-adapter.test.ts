import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiMock = vi.hoisted(() => ({
  constructorOptions: undefined as unknown,
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { create: openaiMock.create };

    constructor(options: unknown) {
      openaiMock.constructorOptions = options;
    }
  },
}));

import { generateWithOpenAI } from "../src/main/agent/gateway/openai";

const config = {
  provider: "openai" as const,
  model: "openai-test",
  apiKey: "secret",
  baseURL: "https://openai.example.test",
  timeoutMs: 1234,
  maxOutputTokens: 321,
};

describe("generateWithOpenAI", () => {
  beforeEach(() => {
    openaiMock.create.mockReset();
    openaiMock.constructorOptions = undefined;
  });

  it("calls the Responses API and normalizes its response", async () => {
    openaiMock.create.mockResolvedValue({
      output_text: "  generated text  ",
      _request_id: "req-openai",
    });

    const response = await generateWithOpenAI(config, {
      systemPrompt: "System instruction",
      prompt: "User prompt",
    });

    expect(openaiMock.constructorOptions).toEqual({
      apiKey: "secret",
      baseURL: "https://openai.example.test",
      timeout: 1234,
      maxRetries: 2,
    });
    expect(openaiMock.create).toHaveBeenCalledWith({
      model: "openai-test",
      instructions: "System instruction",
      input: "User prompt",
      max_output_tokens: 321,
    });
    expect(response).toEqual({
      provider: "openai",
      model: "openai-test",
      text: "generated text",
      requestId: "req-openai",
    });
  });

  it("rejects an empty model response", async () => {
    openaiMock.create.mockResolvedValue({ output_text: "   ", _request_id: null });

    await expect(generateWithOpenAI(config, { prompt: "User prompt" })).rejects.toMatchObject({
      code: "empty-response",
      provider: "openai",
    });
  });

  it("normalizes provider authentication errors", async () => {
    openaiMock.create.mockRejectedValue(Object.assign(new Error("bad key"), { status: 401 }));

    await expect(generateWithOpenAI(config, { prompt: "User prompt" })).rejects.toMatchObject({
      code: "authentication",
      provider: "openai",
    });
  });
});
