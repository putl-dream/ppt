import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adjustSnipBoundary,
  emergencyTrimContext,
  findLastToolResultBlock,
  microCompactTranscript,
  prepareContext,
  snipCompactConversation,
  snipCompactTranscript,
  toolResultBudget,
} from "../src/main/agent/runtime/context-compact";
import { compactHistory } from "../src/main/agent/runtime/context-compact/compact-history";
import type { AgentModelGateway } from "../src/main/agent/gateway/types";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-context-compact-"));
  temporaryDirectories.push(workspaceRoot);
  return workspaceRoot;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("snip_compact", () => {
  it("keeps head and tail when messages exceed threshold", () => {
    const conversation = Array.from({ length: 60 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${index}`,
    }));

    const compacted = snipCompactConversation(conversation)!;
    expect(compacted).toHaveLength(51);
    expect(compacted[0].content).toBe("message-0");
    expect(compacted[1].content).toBe("message-1");
    expect(compacted[2].content).toBe("message-2");
    expect(compacted[3].content).toContain("Snipped");
    expect(compacted.at(-1)?.content).toBe("message-59");
  });

  it("does not split assistant tool_use from tool result at boundary", () => {
    const transcript = [
      ...Array.from({ length: 48 }, (_, index) => ({ role: "user", content: `u-${index}` })),
      { role: "assistant", kind: "tool_use", content: "Read" },
      { role: "tool", toolName: "Read", result: "file-body" },
    ];

    const compacted = snipCompactTranscript(transcript);
    const toolUseIndex = compacted.findIndex((entry) => entry.kind === "tool_use");
    const toolResultIndex = compacted.findIndex((entry) => entry.role === "tool");

    expect(toolUseIndex).toBeGreaterThan(-1);
    expect(toolResultIndex).toBe(toolUseIndex + 1);
  });

  it("adjustSnipBoundary walks back across tool_result entries", () => {
    const messages = [
      { role: "assistant", kind: "tool_use" },
      { role: "tool", toolName: "Read", result: "x" },
    ];
    expect(adjustSnipBoundary(messages, 1, 0)).toBe(0);
  });
});

describe("micro_compact", () => {
  it("keeps only the last three tool results at full size", () => {
    const transcript = Array.from({ length: 6 }, (_, index) => ({
      role: "tool",
      toolName: `tool-${index}`,
      result: `payload-${index}`,
    }));

    const compacted = microCompactTranscript(transcript, 3);
    expect(compacted[0].result).toContain("compacted");
    expect(compacted[2].result).toContain("compacted");
    expect(compacted[3].result).toBe("payload-3");
    expect(compacted[5].result).toBe("payload-5");
  });
});

describe("tool_result_budget", () => {
  it("persists oversized trailing tool results to disk", async () => {
    const workspaceRoot = await createWorkspace();
    const large = "x".repeat(150_000);
    const transcript = [
      { role: "user", content: "step" },
      { role: "tool", toolName: "Read", result: large },
      { role: "tool", toolName: "Read", result: large },
    ];

    const block = findLastToolResultBlock(transcript);
    expect(block).toEqual([1, 2]);

    const { transcript: compacted, notes } = await toolResultBudget(transcript, workspaceRoot, 200_000);
    expect(notes.length).toBeGreaterThan(0);
    expect(String(compacted[1].result)).toContain("<persisted-output");
    expect(String(compacted[1].result)).toContain(".task_outputs/tool-results/");

    const persistedPath = String(compacted[1].result).match(/path="([^"]+)"/)?.[1];
    expect(persistedPath).toBeTruthy();
    const diskContent = await readFile(join(workspaceRoot, persistedPath!), "utf8");
    expect(diskContent).toBe(large);
  });
});

describe("compact_history", () => {
  it("archives transcript and replaces active context with summary", async () => {
    const workspaceRoot = await createWorkspace();
    let responseContract: string | undefined;
    const gateway: AgentModelGateway = {
      async generateText(request) {
        responseContract = request.responseContract;
        return {
          provider: "openai",
          model: "gpt",
          content: [{ type: "text", text: "## Goal\nFinish slides." }],
        };
      },
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    const payload = {
      request: "build deck",
      conversation: [{ role: "user" as const, content: "hello" }],
      transcript: [
        { role: "user", content: "build deck" },
        { role: "tool", toolName: "Read", result: "old" },
      ],
    };

    const result = await compactHistory({
      payload,
      workspaceRoot,
      threadId: "thread-1",
      gateway,
    });

    expect(result.skipped).toBe(false);
    expect(responseContract).toBe("markdown-summary");
    expect(result.savedPath).toContain("thread-1-");
    expect(result.savedPath).toContain(".transcripts");
    expect(result.payload.transcript[0]).toMatchObject({
      role: "system",
      kind: "compact_boundary",
    });
    expect(String(result.payload.transcript[0].content)).toContain("Finish slides");
  });

  it("opens circuit breaker after consecutive failures", async () => {
    const gateway: AgentModelGateway = {
      async generateText() {
        throw new Error("summary failed");
      },
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    const payload = { transcript: [{ role: "user", content: "x" }] };
    const blocked = await compactHistory({
      payload,
      workspaceRoot: "/tmp",
      threadId: "t1",
      gateway,
      compactHistoryFailures: 3,
    });

    expect(blocked.skipped).toBe(true);
    expect(blocked.failures).toBe(3);
    expect(blocked.reason).toContain("circuit breaker");

    const failing = await compactHistory({
      payload,
      workspaceRoot: "/tmp",
      threadId: "t1",
      gateway,
      compactHistoryFailures: 2,
    });
    expect(failing.failures).toBe(3);
  });
});

describe("prepareContext", () => {
  it("runs L1-L3 without API and triggers L4 when over threshold", async () => {
    const workspaceRoot = await createWorkspace();
    const generateText = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt",
      content: [{ type: "text", text: "compressed summary" }],
    });
    const gateway: AgentModelGateway = {
      generateText,
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
      },
    };

    const transcript = Array.from({ length: 60 }, (_, index) => ({
      role: "tool",
      toolName: "Read",
      result: "x".repeat(8_000),
    }));

    const result = await prepareContext({
      payload: {
        request: "task",
        transcript,
      },
      systemPrompt: "system",
      workspaceRoot,
      threadId: "thread-2",
      gateway,
      tokenThreshold: 1_000,
      onProgress: () => {},
    });

    expect(result.payload.transcript.length).toBeLessThan(transcript.length);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});

describe("emergencyTrimContext", () => {
  it("aggressively trims on API overflow recovery", () => {
    const payload = {
      request: "task",
      conversation: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        content: `c-${index}`,
      })),
      transcript: Array.from({ length: 20 }, (_, index) => ({
        role: "tool",
        toolName: `tool-${index}`,
        result: `r-${index}`,
      })),
    };

    const trimmed = emergencyTrimContext(payload);
    expect(trimmed.transcript.length).toBeLessThanOrEqual(5);
    expect(trimmed.conversation?.length ?? 0).toBeLessThanOrEqual(4);
  });
});
