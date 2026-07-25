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
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 20 },
      },
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
      content: [{ type: "text", text: "generated text" }],
      requestId: "req-openai",
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 20,
      },
    });
  });

  it("preserves the Responses API incomplete reason as a truncation signal", async () => {
    openaiMock.createResponse.mockResolvedValue({
      output_text: "plausible partial summary",
      output: [],
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      _request_id: "req-incomplete",
    });

    const response = await generateWithOpenAI(config, {
      prompt: "Summarize",
    });

    expect(response).toMatchObject({
      content: [{ type: "text", text: "plausible partial summary" }],
      stopReason: "max_output_tokens",
    });
  });

  it("passes JSON Schema output contracts to the Responses API", async () => {
    openaiMock.createResponse.mockResolvedValue({
      output_text: '{"title":"Deck"}',
      _request_id: "req-json",
    });

    await generateWithOpenAI(config, {
      prompt: "Return metadata",
      outputFormat: {
        type: "json_schema",
        name: "deck_metadata",
        description: "Deck metadata",
        schema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
          additionalProperties: false,
        },
        strict: true,
      },
    });

    expect(openaiMock.createResponse.mock.calls[0]?.[0]).toMatchObject({
      text: {
        format: {
          type: "json_schema",
          name: "deck_metadata",
          description: "Deck metadata",
          strict: true,
          schema: { type: "object", required: ["title"] },
        },
      },
    });
  });

  it("sends native multi-turn history through the Responses API without persisting context", async () => {
    openaiMock.createResponse.mockResolvedValue({
      output_text: "ok",
      output: [],
      _request_id: "req-native-context",
    });
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "canonical user request" }],
      },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "I will inspect the deck." },
          {
            type: "tool_use" as const,
            id: "call-read",
            name: "Read",
            input: { path: "presentation.json" },
          },
        ],
      },
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            toolUseId: "call-read",
            isError: true,
            content: [
              { type: "text" as const, text: '{"title":"Deck"}' },
              {
                type: "image" as const,
                mediaType: "image/png" as const,
                data: "image-data",
              },
            ],
          },
          { type: "text" as const, text: "Use the inspected deck." },
        ],
      },
    ];
    const original = structuredClone(messages);
    const prompt = JSON.stringify({
      transcript: [],
      queryContext: {
        user: { locale: "zh-CN" },
        system: { surface: "desktop" },
      },
    });

    await generateWithOpenAI(config, {
      systemPrompt: "System instruction",
      prompt,
      messages,
    });

    expect(openaiMock.createChatCompletion).not.toHaveBeenCalled();
    expect(openaiMock.createResponse.mock.calls[0]?.[0]).toMatchObject({
      instructions: "System instruction",
      input: [
        { role: "user", content: "canonical user request" },
        { role: "assistant", content: "I will inspect the deck." },
        {
          type: "function_call",
          call_id: "call-read",
          name: "Read",
          arguments: '{"path":"presentation.json"}',
        },
        {
          type: "function_call_output",
          call_id: "call-read",
          output: [
            { type: "input_text", text: '[Tool error]\n{"title":"Deck"}' },
            {
              type: "input_image",
              image_url: "data:image/png;base64,image-data",
              detail: "auto",
            },
          ],
        },
        { role: "user", content: "Use the inspected deck." },
        { role: "user", content: prompt },
      ],
    });
    expect(messages).toEqual(original);
  });

  it("marks text-only tool errors in Responses function call outputs", async () => {
    openaiMock.createResponse.mockResolvedValue({
      output_text: "handled",
      output: [],
      _request_id: "req-tool-error",
    });

    await generateWithOpenAI(config, {
      prompt: "",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Read the protected file." }],
        },
        {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "call-protected",
            name: "Read",
            input: { path: "protected.txt" },
          }],
        },
        {
          role: "user",
          content: [{
            type: "tool_result",
            toolUseId: "call-protected",
            content: [{ type: "text", text: "Permission denied" }],
            isError: true,
          }],
        },
      ],
    });

    expect(openaiMock.createResponse.mock.calls[0]?.[0].input).toContainEqual({
      type: "function_call_output",
      call_id: "call-protected",
      output: "[Tool error]\nPermission denied",
    });
  });

  it("keeps native multi-turn history on explicit Chat Completions mode", async () => {
    openaiMock.createChatCompletion.mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      _request_id: "req-chat-history",
    });

    await generateWithOpenAI(
      { ...config, openaiApiMode: "chat-completions" },
      {
        systemPrompt: "System instruction",
        prompt: "request context",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "canonical user request" }],
          },
          {
            role: "assistant",
            content: [
              { type: "text", text: "I will inspect the deck." },
              {
                type: "tool_use",
                id: "call-read",
                name: "Read",
                input: { path: "presentation.json" },
              },
            ],
          },
          {
            role: "user",
            content: [{
              type: "tool_result",
              toolUseId: "call-read",
              content: [{ type: "text", text: '{"title":"Deck"}' }],
              isError: true,
            }],
          },
        ],
      },
    );

    expect(openaiMock.createResponse).not.toHaveBeenCalled();
    expect(openaiMock.createChatCompletion.mock.calls[0]?.[0].messages).toEqual([
      { role: "system", content: "System instruction" },
      { role: "user", content: "canonical user request" },
      {
        role: "assistant",
        content: "I will inspect the deck.",
        tool_calls: [{
          id: "call-read",
          type: "function",
          function: { name: "Read", arguments: '{"path":"presentation.json"}' },
        }],
      },
      {
        role: "tool",
        tool_call_id: "call-read",
        content: '[Tool error]\n{"title":"Deck"}',
      },
      { role: "user", content: "request context" },
    ]);
  });

  it("keeps one-shot forced tools on the Responses API", async () => {
    openaiMock.createResponse.mockResolvedValue({
      output_text: "",
      output: [{
        type: "function_call",
        call_id: "call-submit",
        name: "submit_deck",
        arguments: '{"title":"Deck"}',
      }],
      _request_id: "req-responses-tool",
    });

    const response = await generateWithOpenAI(config, {
      prompt: "Submit the deck",
      tools: [{
        name: "submit_deck",
        description: "Submit a deck",
        inputSchema: { type: "object", properties: { title: { type: "string" } } },
      }],
      requiredToolName: "submit_deck",
    });

    expect(openaiMock.createChatCompletion).not.toHaveBeenCalled();
    expect(openaiMock.createResponse.mock.calls[0]?.[0]).toMatchObject({
      tools: [{
        type: "function",
        name: "submit_deck",
        strict: true,
      }],
      tool_choice: {
        type: "function",
        name: "submit_deck",
      },
    });
    expect(response.content).toEqual([{
      type: "tool_use",
      id: "call-submit",
      name: "submit_deck",
      input: { title: "Deck" },
    }]);
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
      content: [{ type: "text", text: "compatible text" }],
      requestId: "req-compatible",
      stopReason: "stop",
    });
  });

  it("passes JSON Schema output contracts to Chat Completions", async () => {
    openaiMock.createChatCompletion.mockResolvedValue({
      choices: [{ message: { content: '{"title":"Deck"}' }, finish_reason: "stop" }],
      _request_id: "req-compatible-json",
    });

    await generateWithOpenAI(
      { ...config, openaiApiMode: "chat-completions" },
      {
        prompt: "Return metadata",
        outputFormat: {
          type: "json_schema",
          name: "deck_metadata",
          schema: { type: "object", properties: { title: { type: "string" } } },
        },
      },
    );

    expect(openaiMock.createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "deck_metadata",
          strict: true,
          schema: { type: "object" },
        },
      },
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

    const response = await generateWithOpenAI({
      ...config,
      openaiApiMode: "chat-completions",
    }, {
      systemPrompt: "System instruction",
      prompt: "User prompt",
      tools: [{
        name: "Read",
        description: "Read data",
        inputSchema: { type: "object", properties: {} },
      }],
      requiredToolName: "Read",
    });

    expect(openaiMock.createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "Read" },
      },
    });
    expect(response.content).toEqual([
      expect.objectContaining({
        type: "tool_use",
        id: "call-invalid",
        name: "Read",
        input: {},
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
