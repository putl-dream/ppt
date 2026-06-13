import { describe, expect, it } from "vitest";
import { AgentService } from "../src/main/agent/workflow";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";

describe("AgentService", () => {
  it("pauses for approval and applies commands after resume", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const agent = new AgentService(bus);

    const pending = await agent.start("Quarterly product strategy");
    expect(pending.status).toBe("approval-required");
    expect(bus.getSnapshot().title).toBe("Untitled presentation");

    if (pending.status !== "approval-required") throw new Error("Expected approval request");
    const completed = await agent.resume(pending.approval.threadId, true);

    expect(completed.status).toBe("completed");
    expect(bus.getSnapshot().title).toBe("Quarterly product strategy");
    expect(bus.getSnapshot().slides).toHaveLength(2);
  });

  it("leaves the presentation unchanged after rejection", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const original = bus.getSnapshot();
    const agent = new AgentService(bus);

    const pending = await agent.start("Rejected plan");
    if (pending.status !== "approval-required") throw new Error("Expected approval request");
    const rejected = await agent.resume(pending.approval.threadId, false);

    expect(rejected.status).toBe("rejected");
    expect(bus.getSnapshot()).toEqual(original);
  });
});
