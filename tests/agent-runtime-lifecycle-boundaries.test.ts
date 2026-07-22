import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { clearHooks, registerHook } from "../src/main/agent/runtime/hook-registry";
import type { StopBlock } from "../src/main/agent/runtime/hook-blocks";
import type { AgentModelGateway } from "../src/main/agent/gateway/types";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import type { ToolDefinition } from "../src/main/agent/tools/tool-definition";
import { createStarterPresentation } from "../src/shared/presentation";
import { DurableRunStore } from "../src/main/agent/persistence/durable-run-store";

function textGateway(text: string): AgentModelGateway {
  return {
    async generateText() {
      return { provider: "anthropic", model: "test", content: [{ type: "text", text }] };
    },
    async *generateTextStream() {
      yield { type: "complete" as const, content: [{ type: "text" as const, text }] };
    },
  };
}

function failingGateway(message: string): AgentModelGateway {
  return {
    async generateText() { throw new Error(message); },
    async *generateTextStream() { throw new Error(message); },
  };
}

describe("AgentRuntime terminal boundaries", () => {
  afterEach(() => clearHooks());

  it("returns an already committed result when the Stop hook throws", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "runtime-stop-hook-"));
    registerHook("Stop", () => { throw new Error("stop audit unavailable"); });

    const result = await new AgentRuntime(new ToolRegistry(), textGateway("completed"))
      .run({
        threadId: "stop-hook-thread",
        request: "finish",
        presentationSnapshot: createStarterPresentation(),
        selectedElementIds: [],
        workspaceRoot,
      });

    expect(result).toEqual({ type: "message", content: "completed" });
    const checkpoint = await new DurableRunStore(workspaceRoot).load("stop-hook-thread");
    expect(checkpoint).toMatchObject({ status: "completed", phase: "finished" });
  });

  it("persists failed and emits a failed Stop reason without replacing the primary error", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "runtime-failed-"));
    const stops: StopBlock[] = [];
    registerHook("Stop", (block) => { stops.push(block as StopBlock); return null; });

    await expect(new AgentRuntime(new ToolRegistry(), failingGateway("primary model failure"))
      .run({
        threadId: "failed-thread",
        request: "fail",
        presentationSnapshot: createStarterPresentation(),
        selectedElementIds: [],
        workspaceRoot,
      })).rejects.toThrow("primary model failure");

    const checkpoint = await new DurableRunStore(workspaceRoot).load("failed-thread");
    expect(checkpoint).toMatchObject({
      status: "failed",
      phase: "finished",
      error: expect.stringContaining("primary model failure"),
    });
    expect(stops.at(-1)?.reason).toBe("failed");
  });

  it("persists interrupted and emits aborted when the external signal is cancelled", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "runtime-aborted-"));
    const controller = new AbortController();
    controller.abort("cancelled by test");
    const stops: StopBlock[] = [];
    registerHook("Stop", (block) => { stops.push(block as StopBlock); return null; });

    await expect(new AgentRuntime(new ToolRegistry(), textGateway("unused"))
      .run({
        threadId: "aborted-thread",
        request: "abort",
        presentationSnapshot: createStarterPresentation(),
        selectedElementIds: [],
        workspaceRoot,
        signal: controller.signal,
      })).rejects.toThrow("Run aborted by user");

    const checkpoint = await new DurableRunStore(workspaceRoot).load("aborted-thread");
    expect(checkpoint).toMatchObject({ status: "interrupted", phase: "finished" });
    expect(stops.at(-1)?.reason).toBe("aborted");
  });

  it("classifies a downstream AbortError as interrupted even before the signal flips", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "runtime-downstream-abort-"));
    const stops: StopBlock[] = [];
    registerHook("Stop", (block) => { stops.push(block as StopBlock); return null; });
    const abortError = Object.assign(new Error("provider cancelled"), { name: "AbortError" });
    const gateway: AgentModelGateway = {
      async generateText() { throw abortError; },
      async *generateTextStream() { throw abortError; },
    };

    await expect(new AgentRuntime(new ToolRegistry(), gateway).run({
      threadId: "downstream-abort-thread",
      request: "abort",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
    })).rejects.toBe(abortError);

    const checkpoint = await new DurableRunStore(workspaceRoot).load("downstream-abort-thread");
    expect(checkpoint).toMatchObject({ status: "interrupted", phase: "finished" });
    expect(stops.at(-1)?.reason).toBe("aborted");
  });

  it("does not let a late background settlement overwrite a failed terminal checkpoint", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "runtime-late-background-"));
    let resolvePreview!: () => void;
    const previewDone = new Promise<void>((resolve) => { resolvePreview = resolve; });
    const schema = z.object({ slideId: z.string(), run_in_background: z.boolean().optional() });
    const previewTool: ToolDefinition<typeof schema, { ok: true }> = {
      name: "PreviewSlide",
      description: "Ignores cancellation to exercise late settlement",
      category: "core",
      loadPolicy: "core",
      inputSchema: schema,
      risk: "low",
      execute: async () => { await previewDone; return { ok: true }; },
    };
    const registry = new ToolRegistry();
    registry.register(previewTool);
    let modelStep = 0;
    const gateway: AgentModelGateway = {
      async generateText() {
        modelStep += 1;
        if (modelStep === 1) {
          return {
            provider: "anthropic",
            model: "test",
            content: [{
              type: "tool_use" as const,
              id: "late-preview",
              name: "PreviewSlide",
              input: { slideId: "slide-1", run_in_background: true },
            }],
          };
        }
        throw new Error("model failed while preview was running");
      },
      async *generateTextStream() { throw new Error("streaming not expected"); },
    };

    await expect(new AgentRuntime(registry, gateway).run({
      threadId: "late-background-thread",
      runId: "late-background-run",
      request: "preview",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
    })).rejects.toThrow("model failed while preview was running");

    resolvePreview();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const checkpoint = await new DurableRunStore(workspaceRoot).load("late-background-thread");
    expect(checkpoint).toMatchObject({ status: "failed", phase: "finished" });
  });
});
