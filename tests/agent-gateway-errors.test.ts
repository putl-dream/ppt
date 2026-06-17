import { describe, expect, it } from "vitest";
import {
  AgentGatewayError,
  normalizeProviderError,
} from "../src/main/agent/gateway/errors";

describe("normalizeProviderError", () => {
  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [429, "rate-limit"],
    [408, "timeout"],
    [500, "provider-error"],
  ] as const)("maps HTTP %s to %s", (status, code) => {
    const source = Object.assign(new Error("provider message"), { status });
    const error = normalizeProviderError("openai", source);

    expect(error).toBeInstanceOf(AgentGatewayError);
    expect(error.code).toBe(code);
    expect(error.provider).toBe("openai");
    expect(error.cause).toBe(source);
  });

  it("recognizes timeout errors without an HTTP status", () => {
    const source = Object.assign(new Error("socket timed out"), { name: "ConnectionTimeoutError" });
    const error = normalizeProviderError("anthropic", source);

    expect(error.code).toBe("timeout");
    expect(error.provider).toBe("anthropic");
    expect(error.message).toContain("AGENT_TIMEOUT_MS");
  });

  it("does not wrap an existing gateway error", () => {
    const source = new AgentGatewayError("empty", "empty-response", "openai");

    expect(normalizeProviderError("openai", source)).toBe(source);
  });
});
