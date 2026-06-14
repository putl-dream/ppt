import { describe, expect, it } from "vitest";
import { AgentService } from "../src/main/agent/workflow";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";
import type { AgentPlanner } from "../src/main/agent/planner";
import { AgentGatewayError } from "../src/main/agent/gateway";
import type { AgentOutlinePlanner } from "../src/main/agent/outline-planner";

const readyOutlinePlanner: AgentOutlinePlanner = {
  async review() {
    return {
      mode: "ready",
      intent: "edit-presentation",
      assistantMessage: "Ready to execute.",
      missingInformation: [],
    };
  },
};

describe("AgentService", () => {
  it("streams small talk without emitting presentation workflow progress", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const events: Array<{ type: string; delta?: string }> = [];
    const agent = new AgentService(bus);

    const result = await agent.start("hello", undefined, "AUTO", (event) => events.push(event));

    expect(result).toEqual({
      status: "chat",
      message: "你好！我可以陪你聊聊，也可以帮你制作或修改 PPT。",
    });
    if (result.status !== "chat") throw new Error("Expected chat result");
    expect(events.some((event) => event.type === "request-status")).toBe(true);
    expect(events.some((event) => event.type === "workflow-progress")).toBe(false);
    expect(events.filter((event) => event.type === "text-delta").map((event) => event.delta ?? "").join(""))
      .toBe(result.message);
    expect(bus.getSnapshot().revision).toBe(0);
  });

  it("emits workflow progress only after a presentation intent is confirmed", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const events: Array<{ type: string; message?: string }> = [];
    const agent = new AgentService(bus);

    const result = await agent.start(
      "Create a presentation about AI products",
      undefined,
      "AUTO",
      (event) => events.push(event),
    );

    expect(result.status).toBe("outline-required");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe("request-status");
    expect(events.every((event) => event.type !== "text-delta")).toBe(true);
    expect(events.at(-1)?.message).toContain("大纲草案");
  });

  it("emits a request status before waiting for the outline model", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const events: Array<{ type: string; message?: string }> = [];
    let resolveReview!: (decision: Awaited<ReturnType<AgentOutlinePlanner["review"]>>) => void;
    const outlinePlanner: AgentOutlinePlanner = {
      review: () => new Promise((resolve) => {
        resolveReview = resolve;
      }),
    };
    const agent = new AgentService(bus, undefined, outlinePlanner);

    const pending = agent.start("Create an AI deck", undefined, "AUTO", (event) => events.push(event));

    expect(events[0]).toMatchObject({
      type: "request-status",
      message: "正在理解你的需求...",
    });
    resolveReview({
      mode: "outline-proposal",
      intent: "create-presentation",
      assistantMessage: "Please confirm the outline.",
      outline: {
        title: "AI deck",
        slides: [
          { title: "Context", keyPoints: ["Market"] },
          { title: "Plan", keyPoints: ["Product"] },
          { title: "Next", keyPoints: ["Roadmap"] },
        ],
      },
      missingInformation: [],
    });
    await pending;
  });

  it("pauses for approval and applies commands after resume", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const agent = new AgentService(bus, undefined, readyOutlinePlanner);

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
    const agent = new AgentService(bus, undefined, readyOutlinePlanner);

    const pending = await agent.start("Rejected plan");
    if (pending.status !== "approval-required") throw new Error("Expected approval request");
    const rejected = await agent.resume(pending.approval.threadId, false);

    expect(rejected.status).toBe("rejected");
    expect(bus.getSnapshot()).toEqual(original);
  });

  it("executes immediately when the workflow uses AUTO strategy", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const agent = new AgentService(bus, undefined, readyOutlinePlanner);

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
    const agent = new AgentService(bus, planner, readyOutlinePlanner);

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
    const agent = new AgentService(bus, planner, readyOutlinePlanner);

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
    const agent = new AgentService(bus, planner, readyOutlinePlanner);

    await expect(agent.start("Provider failure", undefined, "AUTO")).rejects.toThrow(
      "Provider request timed out",
    );
    expect(attempts).toBe(1);
  });

  it("asks for outline confirmation before generating a vague presentation request", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const agent = new AgentService(bus);

    const result = await agent.start("Create a presentation about AI products", undefined, "AUTO");

    expect(result.status).toBe("outline-required");
    expect(bus.getSnapshot().revision).toBe(0);
    if (result.status !== "outline-required") throw new Error("Expected outline request");
    expect(result.outlineRequest.outline?.slides).toHaveLength(3);
  });

  it("generates commands only after the proposed outline is confirmed", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const agent = new AgentService(bus);

    const outline = await agent.start("Create a presentation about AI products");
    if (outline.status !== "outline-required") throw new Error("Expected outline request");

    const pending = await agent.confirmOutline(outline.outlineRequest.threadId);
    expect(pending.status).toBe("approval-required");
    expect(bus.getSnapshot().revision).toBe(0);
  });

  it("passes the current draft outline into each follow-up turn", async () => {
    const bus = new CommandBus(createStarterPresentation());
    const seenDrafts: Array<unknown> = [];
    const outlinePlanner: AgentOutlinePlanner = {
      async review(input) {
        seenDrafts.push(input.draftOutline);
        return {
          mode: "outline-proposal",
          intent: "create-presentation",
          assistantMessage: "Review the updated outline.",
          outline: {
            title: "AI products",
            slides: [
              { title: "Context", keyPoints: ["Market"] },
              { title: "Products", keyPoints: ["Portfolio"] },
              { title: "Roadmap", keyPoints: ["Delivery"] },
            ],
          },
          missingInformation: [],
        };
      },
    };
    const agent = new AgentService(bus, undefined, outlinePlanner);

    const first = await agent.start("Create an AI product deck");
    if (first.status !== "outline-required") throw new Error("Expected outline request");
    await agent.continueOutline(first.outlineRequest.threadId, "Replace the second slide");

    expect(seenDrafts[0]).toBeUndefined();
    expect(seenDrafts[1]).toEqual(first.outlineRequest.outline);
  });
});
