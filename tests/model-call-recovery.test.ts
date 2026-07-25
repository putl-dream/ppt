import { describe, expect, it, vi } from "vitest";
import { computeBackoffDelayMs, extractRetryAfterMs } from "../src/main/agent/gateway/withRetry";
import {
  classifyGatewayRecovery,
  isOutputTruncated,
  normalizeProviderError,
} from "../src/main/agent/gateway/errors";
import { compactTranscript } from "../src/main/agent/runtime/turns/transcript-compact";
import { callModelWithRecovery } from "../src/main/agent/runtime/turns/model-call-recovery";
import type {
  AgentModelGateway,
  AgentModelMessage,
} from "../src/main/agent/gateway/types";

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

function canonicalToolHistory(count: number): AgentModelMessage[] {
  return Array.from({ length: count }, (_, index): AgentModelMessage[] => [
    {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: `call-${index}`,
        name: "ReadFile",
        input: { path: `${index}.txt` },
      }],
    },
    {
      role: "user",
      content: [{
        type: "tool_result",
        toolUseId: `call-${index}`,
        content: [{ type: "text", text: `result-${index}` }],
      }],
    },
  ]).flat();
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
    const progress: string[] = [];

    const promise = callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript: [], request: "hello" },
      onRecovery: (message) => progress.push(message),
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
    expect(progress).toEqual(["服务暂时繁忙，正在重试…"]);
    expect(result.recoveryNotes[0]).toMatch(/临时故障|Retry-After|指数退避/);
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
    expect(result.hasAttemptedReactiveCompact).toBe(true);
    const retriedPrompt = JSON.parse(generateText.mock.calls[1][0].prompt);
    expect(retriedPrompt.transcript[0]).toMatchObject({ kind: "compact_boundary" });
    expect(retriedPrompt.transcript.length).toBeLessThanOrEqual(5);
  });

  it("emergency-trims canonical native messages and keeps the caller history immutable", async () => {
    const generateText = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("maximum context length exceeded"), { status: 400 }),
      )
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt",
        content: textContent("ok"),
      });
    const gateway: AgentModelGateway = {
      generateText,
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };
    const messages = canonicalToolHistory(8);
    const original = structuredClone(messages);
    const preparedSnapshots: AgentModelMessage[][] = [];

    const result = await callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript: [], request: "hello" },
      messages,
      onContextPrepared: (_payload, _notes, prepared) => {
        if (prepared) preparedSnapshots.push(prepared);
      },
    });

    expect(result.content).toEqual(textContent("ok"));
    expect(generateText.mock.calls[1][0].messages.length).toBeLessThan(messages.length);
    expect(preparedSnapshots.some((snapshot) => snapshot.length < messages.length)).toBe(true);
    expect(messages).toEqual(original);
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
    const progress: string[] = [];

    const result = await callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript: [], request: "hello" },
      model: { provider: "anthropic", model: "claude" },
      onRecovery: (message) => progress.push(message),
    });

    expect(result.content).toEqual(textContent("done"));
    expect(generateText.mock.calls[0][0].maxOutputTokens).toBeUndefined();
    expect(generateText.mock.calls[1][0].maxOutputTokens).toBe(65536);
    expect(JSON.parse(generateText.mock.calls[1][0].prompt)).toEqual({
      transcript: [],
      request: "hello",
    });
    expect(progress).toEqual(["回复内容较长，正在继续生成…"]);
    expect(result.recoveryNotes[0]).toContain("max_tokens");
    expect(result.maxOutputTokensOverride).toBe(65536);
    expect(result.maxOutputTokensRecoveryCount).toBe(1);
  });

  it("merges every max-output continuation and keeps detecting repeated truncation", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "anthropic",
        model: "claude",
        content: textContent("alpha"),
        stopReason: "max_tokens",
      })
      .mockResolvedValueOnce({
        provider: "anthropic",
        model: "claude",
        content: textContent("beta"),
        stopReason: "max_tokens",
      })
      .mockResolvedValueOnce({
        provider: "anthropic",
        model: "claude",
        content: textContent("gamma"),
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
      maxOutputTokensOverride: 65_536,
    });

    expect(result.content).toEqual(textContent("alphabetagamma"));
    expect(generateText).toHaveBeenCalledTimes(3);
    expect(JSON.parse(generateText.mock.calls[1][0].prompt).continuation.partialOutput)
      .toBe("alpha");
    expect(JSON.parse(generateText.mock.calls[2][0].prompt).continuation.partialOutput)
      .toBe("alphabeta");
    expect(result.stopReason).toBe("end_turn");
  });

  it("continues native history from an ephemeral assistant partial", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "anthropic",
        model: "claude",
        content: textContent("first-half"),
        stopReason: "max_tokens",
      })
      .mockResolvedValueOnce({
        provider: "anthropic",
        model: "claude",
        content: textContent("-second-half"),
        stopReason: "end_turn",
      });
    const gateway: AgentModelGateway = {
      generateText,
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };
    const messages: AgentModelMessage[] = [{
      role: "user",
      content: [{ type: "text", text: "canonical request" }],
    }];
    const original = structuredClone(messages);

    const result = await callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: {
        transcript: [],
        queryContext: {
          source: "user",
          user: { locale: "zh-CN" },
          system: { surface: "desktop" },
        },
      },
      messages,
      maxOutputTokensOverride: 65_536,
    });

    expect(result.content).toEqual(textContent("first-half-second-half"));
    expect(generateText.mock.calls[1][0].prompt).toBe("");
    expect(generateText.mock.calls[1][0].messages.at(-2)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "first-half" }],
    });
    const continuationContext = JSON.parse(
      generateText.mock.calls[1][0].messages.at(-3).content[0].text,
    );
    expect(continuationContext.queryContext.user.locale).toBe("zh-CN");
    expect(messages).toEqual(original);
  });

  it("never reports success while every continuation remains truncated", async () => {
    const gateway: AgentModelGateway = {
      async generateText() {
        return {
          provider: "anthropic",
          model: "claude",
          content: textContent("partial"),
          stopReason: "max_tokens",
        };
      },
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    await expect(callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript: [], request: "hello" },
      maxOutputTokensOverride: 65_536,
    })).rejects.toThrow("remained truncated");
  });

  it("uses the query fallback model after consecutive overloads", async () => {
    vi.useFakeTimers();
    const generateText = vi
      .fn()
      .mockRejectedValueOnce(
        normalizeProviderError(
          "openai",
          Object.assign(new Error("overloaded"), { status: 529 }),
        ),
      )
      .mockRejectedValueOnce(
        normalizeProviderError(
          "openai",
          Object.assign(new Error("overloaded"), { status: 529 }),
        ),
      )
      .mockResolvedValueOnce({
        provider: "anthropic",
        model: "fallback",
        content: textContent("ok"),
      });
    const gateway: AgentModelGateway = {
      generateText,
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    const promise = callModelWithRecovery({
      gateway,
      systemPrompt: "system",
      promptPayload: { transcript: [] },
      model: { provider: "openai", model: "primary" },
      fallbackModel: { provider: "anthropic", model: "fallback" },
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(generateText.mock.calls.map((call) => call[1])).toEqual([
      { provider: "openai", model: "primary" },
      { provider: "openai", model: "primary" },
      { provider: "anthropic", model: "fallback" },
    ]);
    expect(result.modelUsed).toEqual({ provider: "anthropic", model: "fallback" });
    vi.useRealTimers();
  });
});
