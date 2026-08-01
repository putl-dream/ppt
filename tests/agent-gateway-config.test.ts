import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_GATEWAY_CONFIG,
  resolveAgentGatewayConfig,
  resolveAgentGatewayPreferences,
  resolveAgentSearchConfig,
  splitAgentRunServicesConfig,
} from "../src/shared/agent-gateway-config";

describe("agent-gateway-config", () => {
  it("applies defaults", () => {
    expect(resolveAgentGatewayPreferences()).toEqual(DEFAULT_AGENT_GATEWAY_CONFIG);
    expect(resolveAgentGatewayConfig()).toEqual(DEFAULT_AGENT_GATEWAY_CONFIG);
  });

  it("accepts fallback model settings for main process", () => {
    const config = resolveAgentGatewayConfig({
      timeoutMs: 300_000,
      maxOutputTokens: 8192,
      fallbackModel: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "secret",
      },
    });
    expect(config.timeoutMs).toBe(300_000);
    expect(config.fallbackModel?.provider).toBe("anthropic");
  });

  it("resolves optional Tavily search settings separately from the gateway", () => {
    const search = resolveAgentSearchConfig({
      webSearchApiKey: "tvly-secret",
      webSearchEndpoint: "https://api.tavily.com/search",
      webSearchTimeoutMs: 20_000,
    });
    expect(search.webSearchApiKey).toBe("tvly-secret");
    expect(search.webSearchEndpoint).toBe("https://api.tavily.com/search");
    expect(search.webSearchTimeoutMs).toBe(20_000);
  });

  it("splits a legacy flat run-services payload into gateway and search configs", () => {
    const { gateway, search } = splitAgentRunServicesConfig({
      timeoutMs: 300_000,
      maxOutputTokens: 8192,
      webSearchApiKey: "tvly-secret",
      webSearchEndpoint: "https://api.tavily.com/search",
      webSearchTimeoutMs: 20_000,
    });
    expect(gateway).toEqual({
      timeoutMs: 300_000,
      maxOutputTokens: 8192,
    });
    expect(search).toEqual({
      webSearchApiKey: "tvly-secret",
      webSearchEndpoint: "https://api.tavily.com/search",
      webSearchTimeoutMs: 20_000,
    });
    expect(gateway).not.toHaveProperty("webSearchApiKey");
  });
});
