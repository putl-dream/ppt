import { describe, expect, it } from "vitest";
import type { AgentModelSettings } from "../src/shared/agent";
import {
  AgentModelSettingsRegistry,
  DEFAULT_AGENT_TIMEOUT_MS,
  DEFAULT_AGENT_MODELS,
  resolveAgentModelConfig,
  resolveFallbackModelSelection,
} from "../src/main/agent/gateway/config";
import { AgentGatewayError } from "../src/main/agent/gateway/errors";

function settingsRegistry(...primarySettings: AgentModelSettings[]): AgentModelSettingsRegistry {
  const registry = new AgentModelSettingsRegistry();
  for (const settings of primarySettings) registry.registerPrimary(settings);
  return registry;
}

describe("resolveAgentModelConfig", () => {
  it("uses a runtime OpenAI configuration without persisting it in graph state", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "test-openai-model" },
      settingsRegistry({
        provider: "openai",
        model: "test-openai-model",
        apiKey: "runtime-key",
      }),
      {},
    );

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("test-openai-model");
    expect(config.apiKey).toBe("runtime-key");
    expect(config.timeoutMs).toBe(DEFAULT_AGENT_TIMEOUT_MS);
    expect(config.maxOutputTokens).toBe(16_384);
  });

  it("infers Anthropic when only its environment key is present", () => {
    const config = resolveAgentModelConfig(
      undefined,
      settingsRegistry(),
      { ANTHROPIC_API_KEY: "env-key" },
    );

    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe("env-key");
  });

  it("honors explicit provider, model, endpoint, timeout, and token settings", () => {
    const config = resolveAgentModelConfig(
      { provider: "anthropic", model: "selected-model" },
      settingsRegistry(),
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
      callPath: "anthropic",
      timeoutMs: 15000,
      maxOutputTokens: 4096,
    });
  });

  it("does not reuse runtime credentials for a different explicit model", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "selected-model" },
      settingsRegistry({
        provider: "openai",
        model: "runtime-model",
        apiKey: "runtime-key",
      }),
      { OPENAI_API_KEY: "environment-key" },
    );

    expect(config.apiKey).toBe("environment-key");
    expect(config.model).toBe("selected-model");
  });

  it("does not send an environment credential to an unbound runtime endpoint", () => {
    expect(() => resolveAgentModelConfig(
      { provider: "openai", model: "selected-model" },
      settingsRegistry({
        provider: "openai",
        model: "selected-model",
        baseURL: "https://attacker.example.test/v1",
      }),
      { OPENAI_API_KEY: "environment-key" },
    )).toThrow("No API key configured for openai");
  });

  it("allows an environment credential at its normalized explicit endpoint", () => {
    const config = resolveAgentModelConfig(
      { provider: "anthropic", model: "selected-model" },
      settingsRegistry({
        provider: "anthropic",
        model: "selected-model",
        baseURL: "https://anthropic-proxy.example.test/v1/",
      }),
      {
        ANTHROPIC_API_KEY: "environment-key",
        ANTHROPIC_BASE_URL: "https://anthropic-proxy.example.test/v1",
      },
    );

    expect(config.apiKey).toBe("environment-key");
    expect(config.baseURL).toBe("https://anthropic-proxy.example.test/v1/");
  });

  it("allows an environment credential at the provider official endpoint", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "selected-model" },
      settingsRegistry({
        provider: "openai",
        model: "selected-model",
        baseURL: "https://api.openai.com/v1/",
      }),
      { OPENAI_API_KEY: "environment-key" },
    );

    expect(config.apiKey).toBe("environment-key");
    expect(config.baseURL).toBe("https://api.openai.com/v1/");
  });

  it("does not supplement a runtime credential with unbound environment routing", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "selected-model" },
      settingsRegistry({
        provider: "openai",
        model: "selected-model",
        apiKey: "runtime-key",
      }),
      {
        OPENAI_BASE_URL: "https://environment.example.test/v1",
        OPENAI_API_MODE: "chat-completions",
      },
    );

    expect(config.apiKey).toBe("runtime-key");
    expect(config.baseURL).toBeUndefined();
    expect(config.callPath).toBe("responses");
  });

  it("prefers a frontend runtime endpoint and API mode over environment defaults", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "custom-model" },
      settingsRegistry({
        provider: "openai",
        model: "custom-model",
        apiKey: "runtime-key",
        baseURL: "https://runtime.example.test/v1",
        openaiApiMode: "chat-completions",
      }),
      {
        OPENAI_API_KEY: "environment-key",
        OPENAI_BASE_URL: "https://environment.example.test/v1",
        OPENAI_API_MODE: "responses",
      },
    );

    expect(config.baseURL).toBe("https://runtime.example.test/v1");
    expect(config.callPath).toBe("chat");
  });

  it("uses the provider default model when no model override is supplied", () => {
    const config = resolveAgentModelConfig(
      undefined,
      settingsRegistry(),
      { OPENAI_API_KEY: "env-key" },
    );

    expect(config.model).toBe(DEFAULT_AGENT_MODELS.openai);
  });

  it("uses Chat Completions for a custom OpenAI-compatible endpoint", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "compatible-model" },
      settingsRegistry(),
      {
        OPENAI_API_KEY: "env-key",
        OPENAI_BASE_URL: "https://compatible.example.test",
      },
    );

    expect(config.callPath).toBe("chat");
  });

  it("allows the OpenAI API mode to be selected explicitly", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "compatible-model" },
      settingsRegistry(),
      {
        OPENAI_API_KEY: "env-key",
        OPENAI_BASE_URL: "https://compatible.example.test",
        OPENAI_API_MODE: "responses",
      },
    );

    expect(config.callPath).toBe("responses");
  });

  it("rejects an unsupported OpenAI API mode", () => {
    expect(() =>
      resolveAgentModelConfig(
        { provider: "openai", model: "compatible-model" },
        settingsRegistry(),
        {
          OPENAI_API_KEY: "env-key",
          OPENAI_API_MODE: "legacy",
        },
      ),
    ).toThrow("Unsupported OPENAI_API_MODE");
  });

  it("rejects unsupported providers", () => {
    expect(() =>
      resolveAgentModelConfig(undefined, settingsRegistry(), {
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
      resolveAgentModelConfig(undefined, settingsRegistry(), {
        OPENAI_API_KEY: "env-key",
        [name]: value,
      }),
    ).toThrow(`${name} must be a positive integer`);
  });

  it("prefers runtime gateway config over environment timeout and token limits", () => {
    const config = resolveAgentModelConfig(
      { provider: "openai", model: "selected-model" },
      settingsRegistry({
        provider: "openai",
        model: "selected-model",
        apiKey: "runtime-key",
      }),
      {
        AGENT_TIMEOUT_MS: "15000",
        AGENT_MAX_OUTPUT_TOKENS: "4096",
      },
      {
        timeoutMs: 600_000,
        maxOutputTokens: 32_768,
      },
    );

    expect(config.timeoutMs).toBe(600_000);
    expect(config.maxOutputTokens).toBe(32_768);
  });

  it("replaces and clears fallback identities without removing primary identities", () => {
    const registry = settingsRegistry({
      configurationId: "primary-config",
      provider: "openai",
      model: "primary-model",
      apiKey: "primary-key",
    });
    registry.registerFallback({
      configurationId: "old-fallback",
      provider: "openai",
      model: "old-model",
      apiKey: "old-key",
    });
    registry.registerFallback({
      configurationId: "new-fallback",
      provider: "openai",
      model: "new-model",
      apiKey: "new-key",
    });

    expect(() => resolveAgentModelConfig(
      { configurationId: "old-fallback", provider: "openai", model: "old-model" },
      registry,
      {},
    )).toThrow("Unknown model configuration");
    expect(resolveAgentModelConfig(
      { configurationId: "primary-config", provider: "openai", model: "primary-model" },
      registry,
      {},
    ).apiKey).toBe("primary-key");
    expect(resolveAgentModelConfig(
      { configurationId: "new-fallback", provider: "openai", model: "new-model" },
      registry,
      {},
    ).apiKey).toBe("new-key");

    registry.registerFallback(undefined);

    expect(() => resolveAgentModelConfig(
      { configurationId: "new-fallback", provider: "openai", model: "new-model" },
      registry,
      {},
    )).toThrow("Unknown model configuration");
    expect(resolveAgentModelConfig(
      { configurationId: "primary-config", provider: "openai", model: "primary-model" },
      registry,
      {},
    ).apiKey).toBe("primary-key");
  });

  it("resolves fallback model from gateway config", () => {
    const fallback = resolveFallbackModelSelection(
      { provider: "openai", model: "gpt-5.5" },
      {
        timeoutMs: 180_000,
        maxOutputTokens: 16_384,
        fallbackModel: {
          configurationId: "fallback-config",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "secret",
        },
      },
    );

    expect(fallback).toEqual({
      configurationId: "fallback-config",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("allows a same-provider same-model fallback when its configuration identity differs", () => {
    const gatewayConfig = {
      timeoutMs: 180_000,
      maxOutputTokens: 16_384,
      fallbackModel: {
        configurationId: "fallback-config",
        provider: "openai" as const,
        model: "shared-model",
        apiKey: "fallback-key",
      },
    };

    expect(resolveFallbackModelSelection({
      configurationId: "primary-config",
      provider: "openai",
      model: "shared-model",
    }, gatewayConfig)).toEqual({
      configurationId: "fallback-config",
      provider: "openai",
      model: "shared-model",
    });
    expect(resolveFallbackModelSelection({
      configurationId: "fallback-config",
      provider: "openai",
      model: "shared-model",
    }, gatewayConfig)).toBeUndefined();
    expect(resolveFallbackModelSelection(
      {
        configurationId: "primary-config",
        provider: "openai",
        model: "shared-model",
      },
      undefined,
      { AGENT_FALLBACK_PROVIDER: "openai", AGENT_FALLBACK_MODEL: "shared-model" },
    )).toBeUndefined();
  });

  it("reports a clear configuration error when no key is available", () => {
    try {
      resolveAgentModelConfig(
        { provider: "openai", model: "test-model" },
        settingsRegistry(),
        {},
      );
      throw new Error("Expected configuration error");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentGatewayError);
      expect(error).toMatchObject({
        code: "configuration",
        provider: "openai",
      });
      expect((error as Error).message).toContain("Settings");
    }
  });
});
