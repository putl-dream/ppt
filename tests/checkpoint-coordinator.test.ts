import { describe, expect, it } from "vitest";
import { CheckpointCoordinator } from "../src/main/agent/runtime/lifecycle/checkpoint-coordinator";
import type { DurableRunCheckpoint } from "../src/main/agent/persistence/durable-run-store";

function checkpoint(status: DurableRunCheckpoint["status"]): DurableRunCheckpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    threadId: "thread",
    runId: "run",
    status,
    phase: status === "running" ? "before_model" : "finished",
    request: "request",
    baseRevision: 0,
    modelStep: 0,
    modelMessages: [],
    transcript: [],
    queuedToolUses: [],
    pendingToolResults: [],
    pendingUserContent: [],
    discoveredToolNames: [],
    loadedSkillNames: [],
    renderFeedbackUsed: false,
    createdAt: now,
    updatedAt: now,
  };
}

describe("CheckpointCoordinator", () => {
  it("freezes snapshots before they enter the write queue", async () => {
    const saved: DurableRunCheckpoint[] = [];
    const coordinator = new CheckpointCoordinator({
      async save(value) { saved.push(value); },
    });
    const source = checkpoint("running");
    const commit = coordinator.commit(source);
    source.status = "failed";
    await commit;
    expect(saved[0]?.status).toBe("running");
  });

  it("allows a failed terminal write after an ordinary checkpoint fault", async () => {
    const saved: DurableRunCheckpoint[] = [];
    let writes = 0;
    const coordinator = new CheckpointCoordinator({
      async save(value) {
        writes += 1;
        if (writes === 1) throw new Error("ordinary checkpoint unavailable");
        saved.push(value);
      },
    });

    await expect(coordinator.commit(checkpoint("running"))).rejects.toThrow("unavailable");
    await expect(coordinator.commitFailureTerminal(checkpoint("failed"))).resolves.toBe(true);
    expect(saved).toMatchObject([{ status: "failed", phase: "finished" }]);
  });

  it("rejects ordinary writes after the terminal fence", async () => {
    const coordinator = new CheckpointCoordinator({ async save() {} });
    await coordinator.commitTerminal(checkpoint("completed"));
    await expect(coordinator.commit(checkpoint("running"))).rejects.toThrow("terminal_fenced");
  });

  it("reconciles an ambiguously applied revision before writing failure terminal", async () => {
    let revision = 0;
    const saved: DurableRunCheckpoint[] = [];
    let writes = 0;
    const coordinator = new CheckpointCoordinator({
      async save() {},
      async saveCas(input) {
        writes += 1;
        revision = input.nextRevision;
        saved.push(structuredClone(input.checkpoint));
        if (writes === 1) throw new Error("connection lost after commit");
        return "saved" as const;
      },
      async inspectLease() {
        return { type: "active" as const, revision };
      },
      async closeLease() { return true; },
    }, { threadId: "thread", runId: "run", generation: 1 });

    await expect(coordinator.commit(checkpoint("running"))).rejects.toThrow("connection lost");
    await expect(coordinator.commitFailureTerminal(checkpoint("failed"))).resolves.toBe(true);

    expect(revision).toBe(2);
    expect(saved.map((item) => item.status)).toEqual(["running", "failed"]);
  });
});
