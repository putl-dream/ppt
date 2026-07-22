import { describe, expect, it } from "vitest";
import { AgentService } from "../src/main/agent/service";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import type { AgentModelGateway } from "../src/main/agent/gateway/types";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { CommitGate } from "../src/main/agent/gate/commit-gate";
import { RiskPolicy } from "../src/main/agent/gate/risk-policy";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";

describe("AgentService thread run ownership", () => {
  it("rejects a concurrent run for the same thread before it reaches the Runtime", async () => {
    let releaseModel!: () => void;
    const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
    let markModelStarted!: () => void;
    const modelStarted = new Promise<void>((resolve) => { markModelStarted = resolve; });
    let modelCalls = 0;
    const gateway: AgentModelGateway = {
      async generateText() {
        modelCalls += 1;
        markModelStarted();
        await modelGate;
        return {
          provider: "anthropic",
          model: "test",
          content: [{ type: "text", text: "done" }],
        };
      },
      async *generateTextStream() {
        throw new Error("streaming not expected");
      },
    };
    const service = new AgentService(
      new CommandBus(createStarterPresentation()),
      new AgentRuntime(new ToolRegistry(), gateway),
      new CommitGate(new RiskPolicy()),
    );

    const first = service.start(
      "first",
      undefined,
      "REQUEST_APPROVAL",
      undefined,
      undefined,
      [],
      undefined,
      "shared-thread",
    );
    await modelStarted;

    await expect(service.start(
      "second",
      undefined,
      "REQUEST_APPROVAL",
      undefined,
      undefined,
      [],
      undefined,
      "shared-thread",
    )).rejects.toThrow("already has an active run");

    expect(modelCalls).toBe(1);
    releaseModel();
    await expect(first).resolves.toMatchObject({ status: "chat", message: "done" });
  });
});
