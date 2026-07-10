import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  openai: vi.fn(),
  anthropic: vi.fn(),
}));

vi.mock("../src/main/agent/gateway/openai", () => ({
  generateWithOpenAI: providerMocks.openai,
}));

vi.mock("../src/main/agent/gateway/anthropic", () => ({
  generateWithAnthropic: providerMocks.anthropic,
}));

import { AgentGateway } from "../src/main/agent/gateway";
import { textFromContentBlocks } from "../src/main/agent/gateway/content-blocks";

describe("AgentGateway", () => {
  beforeEach(() => {
    providerMocks.openai.mockReset();
    providerMocks.anthropic.mockReset();
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
});
