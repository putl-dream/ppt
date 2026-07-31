import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  openai: vi.fn(),
  anthropic: vi.fn(),
  openaiStream: vi.fn(),
  anthropicStream: vi.fn(),
}));

vi.mock("../src/main/agent/gateway/openai", () => ({
  generateWithOpenAI: providerMocks.openai,
  generateStreamWithOpenAI: providerMocks.openaiStream,
}));

vi.mock("../src/main/agent/gateway/anthropic", () => ({
  generateWithAnthropic: providerMocks.anthropic,
  generateStreamWithAnthropic: providerMocks.anthropicStream,
}));

import { AgentGateway } from "../src/main/agent/gateway";
import { textFromContentBlocks } from "../src/main/agent/gateway/content-blocks";

describe("AgentGateway", () => {
  beforeEach(() => {
    providerMocks.openai.mockReset();
    providerMocks.anthropic.mockReset();
    providerMocks.openaiStream.mockReset();
    providerMocks.anthropicStream.mockReset();
  });

  it("preserves a declared 1M context capability in the model selection", () => {
    const gateway = new AgentGateway();

    const selection = gateway.configure({
      configurationId: "configured-model",
      provider: "openai",
      model: "extended-context-model",
      apiKey: "secret",
      supports1MContext: true,
    });

    expect(selection).toEqual({
      configurationId: "configured-model",
      provider: "openai",
      model: "extended-context-model",
      supports1MContext: true,
    });
    expect(selection).not.toHaveProperty("apiKey");
  });

  it("routes an OpenAI selection to the OpenAI adapter", async () => {
    providerMocks.openai.mockResolvedValue({
      provider: "openai",
      model: "openai-test",
      content: [{ type: "text", text: "hello" }],
    });
    const gateway = new AgentGateway();
    gateway.configure({ provider: "openai", model: "openai-test", apiKey: "secret" });

    const response = await gateway.generateText(
      { prompt: "Hello" },
      { provider: "openai", model: "openai-test" },
    );

    expect(textFromContentBlocks(response.content)).toBe("hello");
    expect(providerMocks.openai).toHaveBeenCalledOnce();
    expect(providerMocks.anthropic).not.toHaveBeenCalled();
    expect(providerMocks.openai.mock.calls[0][0]).toMatchObject({
      provider: "openai",
      model: "openai-test",
      apiKey: "secret",
    });
  });

  it("routes an Anthropic selection to the Anthropic adapter", async () => {
    providerMocks.anthropic.mockResolvedValue({
      provider: "anthropic",
      model: "anthropic-test",
      content: [{ type: "text", text: "hello" }],
    });
    const gateway = new AgentGateway();
    const selection = gateway.configure({
      provider: "anthropic",
      model: "anthropic-test",
      apiKey: "secret",
    });

    await gateway.generateText({ prompt: "Hello" }, selection);

    expect(selection).toEqual({ provider: "anthropic", model: "anthropic-test" });
    expect(selection).not.toHaveProperty("apiKey");
    expect(providerMocks.anthropic).toHaveBeenCalledOnce();
    expect(providerMocks.openai).not.toHaveBeenCalled();
  });

  it("records configuration IDs for regular and streaming usage", async () => {
    providerMocks.openai.mockResolvedValue({
      provider: "openai",
      model: "priced-model",
      content: [{ type: "text", text: "hello" }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    providerMocks.openaiStream.mockImplementation(async function* () {
      yield {
        type: "complete",
        content: [],
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      };
    });
    const gateway = new AgentGateway();
    const recorder = vi.fn().mockResolvedValue(undefined);
    gateway.setUsageRecorder(recorder);
    const selection = gateway.configure({
      configurationId: "price-config",
      provider: "openai",
      model: "priced-model",
      apiKey: "secret",
    });

    await gateway.generateText({ prompt: "Hello" }, selection);
    for await (const _chunk of gateway.generateTextStream({ prompt: "Hello" }, selection)) {
      // Consume the stream so the completion usage is recorded.
    }

    expect(recorder).toHaveBeenNthCalledWith(1, expect.objectContaining({
      configurationId: "price-config",
      totalTokens: 15,
    }));
    expect(recorder).toHaveBeenNthCalledWith(2, expect.objectContaining({
      configurationId: "price-config",
      totalTokens: 30,
    }));
  });
});
