import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_GATEWAY_CONFIG,
  resolveAgentGatewayConfig,
  resolveAgentGatewayPreferences,
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

  it("passes optional Tavily search settings to the main process", () => {
    const config = resolveAgentGatewayConfig({
      webSearchApiKey: "tvly-secret",
      webSearchEndpoint: "https://api.tavily.com/search",
      webSearchTimeoutMs: 20_000,
    });
    expect(config.webSearchApiKey).toBe("tvly-secret");
    expect(config.webSearchEndpoint).toBe("https://api.tavily.com/search");
    expect(config.webSearchTimeoutMs).toBe(20_000);
  });
});
