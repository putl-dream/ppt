import { beforeEach, describe, expect, it, vi } from "vitest";

const openAIMock = vi.hoisted(() => ({
  constructorOptions: undefined as unknown,
  chatCreate: vi.fn(),
  responsesCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = { completions: { create: openAIMock.chatCreate } };
    responses = { create: openAIMock.responsesCreate };
    constructor(options: unknown) {
      openAIMock.constructorOptions = options;
    }
  },
}));

import {
  generateStreamWithOpenAI,
  generateWithOpenAI,
} from "../src/main/agent/gateway/openai";
import type { PreparedAgentModelRequest } from "../src/main/agent/gateway/types";

const baseConfig = {
  provider: "openai" as const,
  model: "openai-test",
  apiKey: "secret",
  baseURL: "https://openai.example.test",
  timeoutMs: 2345,
  maxOutputTokens: 321,
};

function preparedRequest(
  text: string,
  overrides: Partial<PreparedAgentModelRequest> = {},
): PreparedAgentModelRequest {
  return {
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    maxOutputTokens: baseConfig.maxOutputTokens,
    ...overrides,
  };
}

describe("OpenAI driver", () => {
  beforeEach(() => {
    openAIMock.chatCreate.mockReset();
    openAIMock.responsesCreate.mockReset();
    openAIMock.constructorOptions = undefined;
  });

  it("maps a prepared Chat Completions request and usage", async () => {
    openAIMock.chatCreate.mockResolvedValue({
      choices: [{ message: { content: "answer" }, finish_reason: "stop" }],
      _request_id: "req-chat",
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    });
    const config = { ...baseConfig, openaiApiMode: "chat-completions" as const };

    const response = await generateWithOpenAI(config, preparedRequest("prompt", {
      systemPrompt: "system",
    }));

    expect(openAIMock.constructorOptions).toEqual({
      apiKey: "secret",
      baseURL: "https://openai.example.test",
      timeout: 2345,
      maxRetries: 0,
    });
    expect(openAIMock.chatCreate).toHaveBeenCalledWith({
      model: "openai-test",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "prompt" },
      ],
      max_tokens: 321,
    }, { signal: undefined });
    expect(response).toEqual({
      provider: "openai",
      model: "openai-test",
      content: [{ type: "text", text: "answer" }],
      requestId: "req-chat",
      stopReason: "end",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
  });

  it("maps Responses input, native tool calls, and cached usage", async () => {
    openAIMock.responsesCreate.mockResolvedValue({
      output_text: "Inspecting",
      output: [{
        type: "function_call",
        call_id: "call-2",
        name: "Read",
        arguments: "{\"slide\":2}",
      }],
      status: "completed",
      _request_id: "req-response",
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        total_tokens: 25,
        input_tokens_details: { cached_tokens: 7 },
      },
    });

    const response = await generateWithOpenAI(baseConfig, preparedRequest("", {
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call-1", name: "Preview", input: {} }],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            toolUseId: "call-1",
            content: [{ type: "text", text: "done" }],
          }],
        },
      ],
      tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
    }));

    expect(openAIMock.responsesCreate.mock.calls[0]?.[0]).toMatchObject({
      instructions: undefined,
      input: [
        { type: "function_call", call_id: "call-1", name: "Preview", arguments: "{}" },
        { type: "function_call_output", call_id: "call-1", output: "done" },
      ],
      max_output_tokens: 321,
      tools: [{ type: "function", name: "Read" }],
    });
    expect(response.content).toEqual([
      { type: "text", text: "Inspecting" },
      { type: "tool_use", id: "call-2", name: "Read", input: { slide: 2 } },
    ]);
    expect(response.usage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      cachedInputTokens: 7,
    });
  });

  it("preserves malformed Chat tool arguments as a non-executable block", async () => {
    openAIMock.chatCreate.mockResolvedValue({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "Read", arguments: "{" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    });

    const response = await generateWithOpenAI(
      { ...baseConfig, openaiApiMode: "chat-completions" },
      preparedRequest("prompt"),
    );

    expect(response.content).toEqual([{
      type: "tool_use",
      id: "call-1",
      name: "Read",
      input: {},
      parseError: expect.stringContaining("Invalid tool argument JSON"),
    }]);
  });

  it("streams Chat text and reports one complete chunk", async () => {
    openAIMock.chatCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "hel" }, finish_reason: null }] };
        yield {
          choices: [{ delta: { content: "lo" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        };
      },
    });

    const chunks = [];
    for await (const chunk of generateStreamWithOpenAI(
      { ...baseConfig, openaiApiMode: "chat-completions" },
      preparedRequest("prompt"),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "text_delta", text: "hel" },
      { type: "text_delta", text: "lo" },
      {
        type: "complete",
        content: [{ type: "text", text: "hello" }],
        stopReason: "end",
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      },
    ]);
  });

  it("adapts a non-streaming Responses attempt to the common stream protocol", async () => {
    openAIMock.responsesCreate.mockResolvedValue({
      output_text: "answer",
      output: [],
      status: "completed",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });

    const chunks = [];
    for await (const chunk of generateStreamWithOpenAI(baseConfig, preparedRequest("prompt"))) {
      chunks.push(chunk);
    }

    expect(openAIMock.responsesCreate).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([
      { type: "text_delta", text: "answer" },
      {
        type: "complete",
        content: [{ type: "text", text: "answer" }],
        stopReason: undefined,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ]);
  });

  it("leaves empty-response validation and error normalization to Gateway", async () => {
    openAIMock.responsesCreate.mockResolvedValueOnce({
      output_text: "",
      output: [],
      status: "completed",
    });
    await expect(generateWithOpenAI(baseConfig, preparedRequest("prompt"))).resolves.toMatchObject({
      content: [],
    });

    const source = Object.assign(new Error("rate limited"), { status: 429 });
    openAIMock.responsesCreate.mockRejectedValueOnce(source);
    await expect(generateWithOpenAI(baseConfig, preparedRequest("prompt"))).rejects.toBe(source);
  });
});
