import { describe, expect, it, vi } from "vitest";
import {
  coordinateAgentRun,
  createAgentRunLock,
  type AgentRunContext,
} from "../src/shared/agent-run-lifecycle";

const context: AgentRunContext = {
  runId: "run-1",
  streamMessageId: "message-1",
  sessionId: "session-1",
  projectId: "project-1",
  sidechain: false,
};

describe("agent run lifecycle", () => {
  it("acquires and releases the blocking run synchronously", () => {
    const lock = createAgentRunLock();

    expect(lock.acquire("run-1")).toBe(true);
    expect(lock.hasBlockingRun()).toBe(true);
    expect(lock.acquire("run-2")).toBe(false);
    expect(lock.release("run-2")).toBe(false);
    expect(lock.hasBlockingRun()).toBe(true);
    expect(lock.release("run-1")).toBe(true);
    expect(lock.hasBlockingRun()).toBe(false);
    expect(lock.acquire("run-2")).toBe(true);
  });

  it("runs preparation, execution, finalization, and cleanup in order", async () => {
    const calls: string[] = [];

    await coordinateAgentRun({
      prepareContext: async () => {
        calls.push("prepare");
        return context;
      },
      execute: async () => {
        calls.push("execute");
        return "result";
      },
      finalize: async (_context, result) => {
        calls.push(`finalize:${result}`);
      },
      handleFailure: vi.fn(),
      cleanup: () => calls.push("cleanup"),
    });

    expect(calls).toEqual([
      "prepare",
      "execute",
      "finalize:result",
      "cleanup",
    ]);
  });

  it("handles preparation failures and always cleans up", async () => {
    const failure = new Error("context failed");
    const handleFailure = vi.fn();
    const cleanup = vi.fn();

    await coordinateAgentRun({
      prepareContext: async () => {
        throw failure;
      },
      execute: vi.fn(),
      finalize: vi.fn(),
      handleFailure,
      cleanup,
    });

    expect(handleFailure).toHaveBeenCalledWith(failure, undefined);
    expect(cleanup).toHaveBeenCalledWith(undefined);
  });

  it("cleans up without reporting failure when context is unavailable", async () => {
    const execute = vi.fn();
    const handleFailure = vi.fn();
    const cleanup = vi.fn();

    await coordinateAgentRun({
      prepareContext: async () => undefined,
      execute,
      finalize: vi.fn(),
      handleFailure,
      cleanup,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(handleFailure).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith(undefined);
  });

  it("routes finalization failures through the same failure and cleanup path", async () => {
    const failure = new Error("finalization failed");
    const handleFailure = vi.fn();
    const cleanup = vi.fn();

    await coordinateAgentRun({
      prepareContext: async () => context,
      execute: async () => "result",
      finalize: async () => {
        throw failure;
      },
      handleFailure,
      cleanup,
    });

    expect(handleFailure).toHaveBeenCalledWith(failure, context);
    expect(cleanup).toHaveBeenCalledWith(context);
  });
});
