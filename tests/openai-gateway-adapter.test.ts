import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiMock = vi.hoisted(() => ({
  constructorOptions: undefined as unknown,
  createResponse: vi.fn(),
  createChatCompletion: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { create: openaiMock.createResponse };
    chat = { completions: { create: openaiMock.createChatCompletion } };

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
    openaiMock.createResponse.mockReset();
    openaiMock.createChatCompletion.mockReset();
    openaiMock.constructorOptions = undefined;
  });

  it("calls the Responses API and normalizes its response", async () => {
    openaiMock.createResponse.mockResolvedValue({
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
      maxRetries: 0,
    });
    expect(openaiMock.createResponse).toHaveBeenCalledWith(
      {
        model: "openai-test",
        instructions: "System instruction",
        input: "User prompt",
        max_output_tokens: 321,
      },
      { signal: undefined },
    );
    expect(response).toEqual({
      provider: "openai",
      model: "openai-test",
      text: "generated text",
      contentBlocks: [{ type: "text", text: "generated text" }],
      requestId: "req-openai",
    });
  });

  it("calls Chat Completions for OpenAI-compatible endpoints", async () => {
    openaiMock.createChatCompletion.mockResolvedValue({
      choices: [{ message: { content: " compatible text " }, finish_reason: "stop" }],
      _request_id: "req-compatible",
    });

    const response = await generateWithOpenAI(
      { ...config, openaiApiMode: "chat-completions" },
      { systemPrompt: "System instruction", prompt: "User prompt" },
    );

    expect(openaiMock.createChatCompletion).toHaveBeenCalledWith(
      {
        model: "openai-test",
        messages: [
          { role: "system", content: "System instruction" },
          { role: "user", content: "User prompt" },
        ],
        max_tokens: 321,
      },
      { signal: undefined },
    );
    expect(response).toEqual({
      provider: "openai",
      model: "openai-test",
      text: "compatible text",
      contentBlocks: [{ type: "text", text: "compatible text" }],
      requestId: "req-compatible",
      stopReason: "stop",
    });
  });

  it("preserves malformed native tool arguments as a runtime error instead of executing empty args", async () => {
    openaiMock.createChatCompletion.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call-invalid",
            type: "function",
            function: { name: "Read", arguments: "{not-json" },
          }],
        },
        finish_reason: "tool_calls",
      }],
      _request_id: "req-invalid-tool",
    });

    const response = await generateWithOpenAI(config, {
      systemPrompt: "System instruction",
      prompt: "User prompt",
      tools: [{
        name: "Read",
        description: "Read data",
        inputSchema: { type: "object", properties: {} },
      }],
    });

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        id: "call-invalid",
        name: "Read",
        args: {},
        parseError: expect.stringContaining("Invalid tool argument JSON"),
      }),
    ]);
  });

  it("rejects an empty model response", async () => {
    openaiMock.createResponse.mockResolvedValue({ output_text: "   ", _request_id: null });

    await expect(generateWithOpenAI(config, { prompt: "User prompt" })).rejects.toMatchObject({
      code: "empty-response",
      provider: "openai",
    });
  });

  it("normalizes provider authentication errors", async () => {
    openaiMock.createResponse.mockRejectedValue(Object.assign(new Error("bad key"), { status: 401 }));

    await expect(generateWithOpenAI(config, { prompt: "User prompt" })).rejects.toMatchObject({
      code: "authentication",
      provider: "openai",
    });
  });
});
