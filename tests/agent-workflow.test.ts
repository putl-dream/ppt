import { describe, expect, it } from "vitest";
import { AgentService } from "../src/main/agent/workflow";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";
import type { AgentPlanner } from "../src/main/agent/planner";
import { AgentGatewayError } from "../src/main/agent/gateway";

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

  it("executes immediately when the workflow uses AUTO strategy", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const agent = new AgentService(bus);

    const completed = await agent.start("Automatic strategy", undefined, "AUTO");

    expect(completed.status).toBe("completed");
    expect(bus.getSnapshot().title).toBe("Automatic strategy");
    expect(bus.getSnapshot().slides).toHaveLength(2);
  });

  it("feeds semantic command errors back to the planner and retries", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const calls: Array<{ feedback?: string[]; attempt?: number }> = [];
    const planner: AgentPlanner = {
      async plan(input) {
        calls.push({ feedback: input.feedback, attempt: input.attempt });
        if (calls.length === 1) {
          return {
            summary: "Remove a missing slide.",
            commands: [
              { id: crypto.randomUUID(), type: "remove-slide", slideId: "missing-slide" },
            ],
          };
        }
        return {
          summary: "Use a valid title update instead.",
          commands: [
            { id: crypto.randomUUID(), type: "set-presentation-title", title: "Recovered plan" },
          ],
        };
      },
    };
    const agent = new AgentService(bus, planner);

    const completed = await agent.start("Repair the plan", undefined, "AUTO");

    expect(completed.status).toBe("completed");
    expect(calls).toHaveLength(2);
    expect(calls[0].attempt).toBe(1);
    expect(calls[1].attempt).toBe(2);
    expect(calls[1].feedback?.[0]).toContain("Slide not found: missing-slide");
    expect(bus.getSnapshot().title).toBe("Recovered plan");
  });

  it("fails after three invalid planning attempts", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const planner: AgentPlanner = {
      async plan() {
        return {
          summary: "Still invalid.",
          commands: [
            { id: crypto.randomUUID(), type: "remove-slide", slideId: "missing-slide" },
          ],
        };
      },
    };
    const agent = new AgentService(bus, planner);

    await expect(agent.start("Impossible plan", undefined, "AUTO")).rejects.toThrow(
      "after 3 attempts",
    );
  });

  it("does not retry provider failures", async () => {
    const bus = new CommandBus(createStarterPresentation());
    let attempts = 0;
    const planner: AgentPlanner = {
      async plan() {
        attempts += 1;
        throw new AgentGatewayError("Provider request timed out", "timeout", "openai");
      },
    };
    const agent = new AgentService(bus, planner);

    await expect(agent.start("Provider failure", undefined, "AUTO")).rejects.toThrow(
      "Provider request timed out",
    );
    expect(attempts).toBe(1);
  });
});
