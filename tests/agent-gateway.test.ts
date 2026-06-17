import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TIMEOUT_MS,
  DEFAULT_AGENT_MODELS,
  resolveAgentModelConfig,
} from "../src/main/agent/gateway/config";
import { AgentGatewayError } from "../src/main/agent/gateway/errors";

describe("resolveAgentModelConfig", () => {
  it("uses a runtime OpenAI configuration without persisting it in graph state", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "test-openai-model" },
      {
        openai: {
          provider: "openai",
          model: "test-openai-model",
          apiKey: "runtime-key",
        },
      },
      {},
    );

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("test-openai-model");
    expect(config.apiKey).toBe("runtime-key");
    expect(config.timeoutMs).toBe(DEFAULT_AGENT_TIMEOUT_MS);
    expect(config.maxOutputTokens).toBe(16_384);
  });

  it("infers Anthropic when only its environment key is present", () => {
    const config = resolveAgentModelConfig(undefined, {}, { ANTHROPIC_API_KEY: "env-key" });

    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe("env-key");
  });

  it("honors explicit provider, model, endpoint, timeout, and token settings", () => {
    const config = resolveAgentModelConfig(
      { provider: "anthropic", model: "selected-model" },
      {},
      {
        ANTHROPIC_API_KEY: "env-key",
        ANTHROPIC_BASE_URL: "https://anthropic.example.test",
        AGENT_TIMEOUT_MS: "15000",
        AGENT_MAX_OUTPUT_TOKENS: "4096",
      },
    );

    expect(config).toEqual({
      provider: "anthropic",
      model: "selected-model",
      apiKey: "env-key",
      baseURL: "https://anthropic.example.test",
      openaiApiMode: undefined,
      timeoutMs: 15000,
      maxOutputTokens: 4096,
    });
  });

  it("prefers runtime credentials over environment credentials", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "selected-model" },
      {
        openai: {
          provider: "openai",
          model: "runtime-model",
          apiKey: "runtime-key",
        },
      },
      { OPENAI_API_KEY: "environment-key" },
    );

    expect(config.apiKey).toBe("runtime-key");
    expect(config.model).toBe("selected-model");
  });

  it("prefers a frontend runtime endpoint and API mode over environment defaults", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "custom-model" },
      {
        openai: {
          provider: "openai",
          model: "custom-model",
          apiKey: "runtime-key",
          baseURL: "https://runtime.example.test/v1",
          openaiApiMode: "chat-completions",
        },
      },
      {
        OPENAI_API_KEY: "environment-key",
        OPENAI_BASE_URL: "https://environment.example.test/v1",
        OPENAI_API_MODE: "responses",
      },
    );

    expect(config.baseURL).toBe("https://runtime.example.test/v1");
    expect(config.openaiApiMode).toBe("chat-completions");
  });

  it("uses the provider default model when no model override is supplied", () => {
    const config = resolveAgentModelConfig(undefined, {}, { OPENAI_API_KEY: "env-key" });

    expect(config.model).toBe(DEFAULT_AGENT_MODELS.openai);
  });

  it("uses Chat Completions for a custom OpenAI-compatible endpoint", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "compatible-model" },
      {},
      {
        OPENAI_API_KEY: "env-key",
        OPENAI_BASE_URL: "https://compatible.example.test",
      },
    );

    expect(config.openaiApiMode).toBe("chat-completions");
  });

  it("allows the OpenAI API mode to be selected explicitly", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "compatible-model" },
      {},
      {
        OPENAI_API_KEY: "env-key",
        OPENAI_BASE_URL: "https://compatible.example.test",
        OPENAI_API_MODE: "responses",
      },
    );

    expect(config.openaiApiMode).toBe("responses");
  });

  it("rejects an unsupported OpenAI API mode", () => {
    expect(() =>
      resolveAgentModelConfig(
        { provider: "openai", model: "compatible-model" },
        {},
        {
          OPENAI_API_KEY: "env-key",
          OPENAI_API_MODE: "legacy",
        },
      ),
    ).toThrow("Unsupported OPENAI_API_MODE");
  });

  it("rejects unsupported providers", () => {
    expect(() =>
      resolveAgentModelConfig(undefined, {}, {
        AGENT_PROVIDER: "unsupported",
        OPENAI_API_KEY: "env-key",
      }),
    ).toThrow("Unsupported AGENT_PROVIDER");
  });

  it.each([
    ["AGENT_TIMEOUT_MS", "0"],
    ["AGENT_TIMEOUT_MS", "1.5"],
    ["AGENT_MAX_OUTPUT_TOKENS", "invalid"],
  ])("rejects invalid %s values", (name, value) => {
    expect(() =>
      resolveAgentModelConfig(undefined, {}, {
        OPENAI_API_KEY: "env-key",
        [name]: value,
      }),
    ).toThrow(`${name} must be a positive integer`);
  });

  it("reports a clear configuration error when no key is available", () => {
    try {
      resolveAgentModelConfig({ provider: "openai", model: "test-model" }, {}, {});
      throw new Error("Expected configuration error");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentGatewayError);
      expect(error).toMatchObject({
        code: "configuration",
        provider: "openai",
      });
      expect((error as Error).message).toContain("No API key configured for openai");
    }
  });
});
