import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentLogger, createModuleLogger, requestSummary } from "../src/main/agent/logger";

const originalLogLevel = process.env.AGENT_LOG_LEVEL;
const originalLogFile = process.env.AGENT_LOG_FILE;

beforeEach(() => {
  // Disable file logging in tests
  process.env.AGENT_LOG_FILE = "false";
});

afterEach(() => {
  if (originalLogLevel === undefined) {
    delete process.env.AGENT_LOG_LEVEL;
  } else {
    process.env.AGENT_LOG_LEVEL = originalLogLevel;
  }
  if (originalLogFile === undefined) {
    delete process.env.AGENT_LOG_FILE;
  } else {
    process.env.AGENT_LOG_FILE = originalLogFile;
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

  it("escapes Unicode so Windows console code pages cannot corrupt log text", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    agentLogger.info("conversation.outline.continued", { requestPreview: "啊？你是哪个？" });

    const line = String(info.mock.calls[0][0]);
    expect(line).not.toContain("啊？你是哪个？");
    expect(line).toContain("\\u554a");
    expect(JSON.parse(line.slice(line.indexOf("{")))).toMatchObject({
      requestPreview: "啊？你是哪个？",
    });
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

  it("includes full request when AGENT_LOG_DETAIL=full", () => {
    process.env.AGENT_LOG_DETAIL = "full";
    const request = "你好，帮我设计一个PPT";
    const summary = requestSummary(request);

    expect(summary.requestFull).toBe(request);
    expect(summary.requestPreview).toBe(request);
  });

  it("omits full request when AGENT_LOG_DETAIL=minimal", () => {
    process.env.AGENT_LOG_DETAIL = "minimal";
    const request = "你好，帮我设计一个PPT";
    const summary = requestSummary(request);

    expect(summary.requestFull).toBeUndefined();
  });
});

describe("createModuleLogger", () => {
  it("includes module name in log entries", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createModuleLogger("gateway");

    logger.info("test.event", { value: 123 });

    const line = String(info.mock.calls[0][0]);
    const parsed = JSON.parse(line.slice(line.indexOf("{")));
    expect(parsed.module).toBe("gateway");
    expect(parsed.event).toBe("test.event");
    expect(parsed.value).toBe(123);
  });
});

describe("sensitive data redaction", () => {
  it("redacts API keys and tokens", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    agentLogger.info("test.sensitive", {
      apiKey: "sk-1234567890abcdefghij",
      normalField: "visible",
    });

    const line = String(info.mock.calls[0][0]);
    const parsed = JSON.parse(line.slice(line.indexOf("{")));
    expect(parsed.apiKey).toBe("sk-1...ghij");
    expect(parsed.normalField).toBe("visible");
  });
});
