import { describe, expect, it, vi } from "vitest";
import { computeBackoffDelayMs, extractRetryAfterMs } from "../src/main/agent/gateway/withRetry";
import {
  classifyGatewayRecovery,
  isOutputTruncated,
  normalizeProviderError,
} from "../src/main/agent/gateway/errors";
import { compactTranscript } from "../src/main/agent/runtime/transcript-compact";
import { callModelWithRecovery } from "../src/main/agent/runtime/model-call-recovery";
import type { AgentModelGateway } from "../src/main/agent/gateway/types";

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

describe("computeBackoffDelayMs", () => {
  it("follows exponential backoff with cap", () => {
    expect(computeBackoffDelayMs(1, 0)).toBeGreaterThanOrEqual(500);
    expect(computeBackoffDelayMs(1, 0)).toBeLessThanOrEqual(625);
    expect(computeBackoffDelayMs(2, 0)).toBeGreaterThanOrEqual(1000);
    expect(computeBackoffDelayMs(2, 0)).toBeLessThanOrEqual(1250);
    expect(computeBackoffDelayMs(7, 0)).toBeGreaterThanOrEqual(32000);
    expect(computeBackoffDelayMs(7, 0)).toBeLessThanOrEqual(40000);
  });

  it("prefers Retry-After header when provided", () => {
    expect(computeBackoffDelayMs(3, 2500)).toBe(2500);
  });
});

describe("extractRetryAfterMs", () => {
  it("parses numeric seconds from headers", () => {
    const error = {
      headers: {
        get: (name: string) => (name === "retry-after" ? "3" : null),
      },
    };
    expect(extractRetryAfterMs(error)).toBe(3000);
  });
});

describe("gateway recovery classification", () => {
  it("maps 529 to overloaded and retry-backoff", () => {
    const error = normalizeProviderError("anthropic", Object.assign(new Error("overloaded"), { status: 529 }));
    expect(error.code).toBe("overloaded");
    expect(classifyGatewayRecovery(error)).toBe("retry-backoff");
  });

  it("maps prompt too long messages", () => {
    const error = normalizeProviderError(
      "openai",
      Object.assign(new Error("maximum context length exceeded"), { status: 400 }),
    );
    expect(error.code).toBe("prompt-too-long");
    expect(classifyGatewayRecovery(error)).toBe("compact-context");
  });

  it("detects output truncation stop reasons", () => {
    expect(isOutputTruncated("max_tokens")).toBe(true);
    expect(isOutputTruncated("length")).toBe(true);
    expect(isOutputTruncated("stop")).toBe(false);
  });
});

describe("compactTranscript", () => {
  it("keeps recent entries and adds compact boundary", () => {
    const transcript = Array.from({ length: 10 }, (_, index) => ({
      role: "tool",
      toolName: `tool-${index}`,
      result: `result-${index}`,
    }));
    const compacted = compactTranscript(transcript, 3);
    expect(compacted).toHaveLength(4);
    expect(compacted[0]).toMatchObject({ kind: "compact_boundary" });
    expect(compacted.at(-1)).toMatchObject({ toolName: "tool-9" });
  });
});

describe("callModelWithRecovery", () => {
  it("projects provider-neutral content blocks into the compatibility result", async () => {
    const gateway: AgentModelGateway = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "test",
          content: [{
            type: "tool_use",
            id: "call-from-block",
            name: "ReadPresentationSnapshot",
            input: {},
          }],
        };
      },
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    const result = await callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript: [], request: "hello" },
    });

    expect(result.content).toEqual([{
      type: "tool_use",
      id: "call-from-block",
      name: "ReadPresentationSnapshot",
      input: {},
    }]);
  });

  it("retries the same request on 429 without appending partial output", async () => {
    vi.useFakeTimers();
    const generateText = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValueOnce({ provider: "openai", model: "gpt", content: textContent("ok") });

    const gateway: AgentModelGateway = {
      generateText,
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    const promise = callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript: [], request: "hello" },
    });

    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.content).toEqual(textContent("ok"));
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(JSON.parse(generateText.mock.calls[0][0].prompt)).toEqual({
      transcript: [],
      request: "hello",
    });
    expect(JSON.parse(generateText.mock.calls[1][0].prompt)).toEqual({
      transcript: [],
      request: "hello",
    });
    vi.useRealTimers();
  });

  it("emergency-trims transcript on prompt-too-long before retrying", async () => {
    const generateText = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("prompt is too long"), { status: 400 }),
      )
      .mockResolvedValueOnce({ provider: "openai", model: "gpt", content: textContent("ok") });

    const gateway: AgentModelGateway = {
      generateText,
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    const transcript = Array.from({ length: 10 }, (_, index) => ({
      role: "tool",
      toolName: `tool-${index}`,
      result: `result-${index}`,
    }));

    const result = await callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript, request: "hello" },
    });

    expect(result.content).toEqual(textContent("ok"));
    const retriedPrompt = JSON.parse(generateText.mock.calls[1][0].prompt);
    expect(retriedPrompt.transcript[0]).toMatchObject({ kind: "compact_boundary" });
    expect(retriedPrompt.transcript.length).toBeLessThanOrEqual(5);
  });

  it("upgrades max tokens before using continuation prompt", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "anthropic",
        model: "claude",
        content: textContent("partial response"),
        stopReason: "max_tokens",
      })
      .mockResolvedValueOnce({
        provider: "anthropic",
        model: "claude",
        content: textContent("done"),
        stopReason: "end_turn",
      });

    const gateway: AgentModelGateway = {
      generateText,
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    const result = await callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript: [], request: "hello" },
      model: { provider: "anthropic", model: "claude" },
    });

    expect(result.content).toEqual(textContent("done"));
    expect(generateText.mock.calls[0][0].maxOutputTokens).toBeUndefined();
    expect(generateText.mock.calls[1][0].maxOutputTokens).toBe(65536);
    expect(JSON.parse(generateText.mock.calls[1][0].prompt)).toEqual({
      transcript: [],
      request: "hello",
    });
  });
});
