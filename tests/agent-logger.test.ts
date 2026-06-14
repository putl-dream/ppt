import { afterEach, describe, expect, it, vi } from "vitest";
import { agentLogger, requestSummary } from "../src/main/agent/logger";

const originalLogLevel = process.env.AGENT_LOG_LEVEL;

afterEach(() => {
  if (originalLogLevel === undefined) {
    delete process.env.AGENT_LOG_LEVEL;
  } else {
    process.env.AGENT_LOG_LEVEL = originalLogLevel;
  }
  vi.restoreAllMocks();
});

describe("agentLogger", () => {
  it("prints structured entries at the configured level", () => {
    process.env.AGENT_LOG_LEVEL = "info";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    agentLogger.info("workflow.finished", { threadId: "thread-1", status: "completed" });

    expect(info).toHaveBeenCalledOnce();
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain("[agent]");
    expect(JSON.parse(line.slice(line.indexOf("{") + 0))).toMatchObject({
      level: "info",
      scope: "agent",
      event: "workflow.finished",
      threadId: "thread-1",
      status: "completed",
    });
  });

  it("does not print debug entries at the default info level", () => {
    process.env.AGENT_LOG_LEVEL = "info";
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    agentLogger.debug("workflow.detail");

    expect(debug).not.toHaveBeenCalled();
  });
});

describe("requestSummary", () => {
  it("normalizes whitespace and truncates long requests", () => {
    const summary = requestSummary(`  ${"a".repeat(170)}\n next  `);

    expect(summary.requestLength).toBeGreaterThan(170);
    expect(summary.requestPreview).toHaveLength(160);
    expect(summary.requestPreview.endsWith("...")).toBe(true);
    expect(summary.requestPreview).not.toContain("\n");
  });
});
