import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agentLogger,
  clearLogFiles,
  createModuleLogger,
  diagnosticValuePreview,
  getLogDirectory,
  getLogManagerSettings,
  getLogManagerStatus,
  getRecentLogEntries,
  requestSummary,
  updateLogManagerSettings,
  withLogContext,
} from "../src/main/agent/logger";

const originalLogLevel = process.env.AGENT_LOG_LEVEL;
const originalLogFile = process.env.AGENT_LOG_FILE;
const originalDataDir = process.env.AGENT_PPT_DATA_DIR;
const originalLogDetail = process.env.AGENT_LOG_DETAIL;

beforeEach(() => {
  // Disable file logging in tests
  process.env.AGENT_LOG_FILE = "false";
  process.env.AGENT_LOG_LEVEL = "info";
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
  if (originalDataDir === undefined) {
    delete process.env.AGENT_PPT_DATA_DIR;
  } else {
    process.env.AGENT_PPT_DATA_DIR = originalDataDir;
  }
  if (originalLogDetail === undefined) {
    delete process.env.AGENT_LOG_DETAIL;
  } else {
    process.env.AGENT_LOG_DETAIL = originalLogDetail;
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

  it("inherits authoritative async context without leaking between concurrent runs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logger = createModuleLogger("context-test");

    await Promise.all([
      withLogContext({ runId: "run-a", threadId: "thread-a" }, async () => {
        await Promise.resolve();
        logger.info("context.a", { runId: "spoofed" });
      }),
      withLogContext({ runId: "run-b", threadId: "thread-b" }, async () => {
        await Promise.resolve();
        logger.info("context.b");
      }),
    ]);

    const entries = info.mock.calls.map(([line]) =>
      JSON.parse(String(line).slice(String(line).indexOf("{"))) as Record<string, unknown>
    );
    expect(entries.find((entry) => entry.event === "context.a")).toMatchObject({
      runId: "run-a",
      threadId: "thread-a",
    });
    expect(entries.find((entry) => entry.event === "context.b")).toMatchObject({
      runId: "run-b",
      threadId: "thread-b",
    });
  });
});

describe("diagnosticValuePreview", () => {
  it("redacts secrets, omits binary fields, and handles circular values", () => {
    const value: Record<string, unknown> = {
      apiKey: "sk-1234567890abcdefghij",
      pngBase64: "a".repeat(2_000),
    };
    value.self = value;

    const preview = diagnosticValuePreview(value, 4_096);

    expect(preview.preview).not.toContain("sk-1234567890abcdefghij");
    expect(preview.preview).toContain("sk-1...ghij");
    expect(preview.preview).toContain("Binary data omitted");
    expect(preview.preview).toContain("[Circular]");
  });

  it("caps the total diagnostic preview length", () => {
    const preview = diagnosticValuePreview({ content: "x".repeat(20_000) }, 256);

    expect(preview.preview).toHaveLength(256);
    expect(preview.truncated).toBe(true);
    expect(preview.serializedLength).toBeGreaterThan(256);
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

  it("redacts credentials embedded in ordinary message fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    agentLogger.info("test.embedded-secret", {
      message: "request failed with Bearer abcdefghijklmnopqrstuvwxyz and sk-1234567890abcdefghij",
    });

    const parsed = JSON.parse(String(info.mock.calls[0][0]).slice(String(info.mock.calls[0][0]).indexOf("{")));
    expect(parsed.message).toContain("Bearer [REDACTED]");
    expect(parsed.message).not.toContain("sk-1234567890abcdefghij");
  });

  it("redacts credentials from serialized errors and stack traces", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    agentLogger.error("test.secret-error", {
      error: new Error("request rejected for sk-1234567890abcdefghij"),
    });

    const line = String(error.mock.calls[0][0]);
    const parsed = JSON.parse(line.slice(line.indexOf("{")));
    expect(parsed.error.message).toContain("[REDACTED]");
    expect(parsed.error.stack).not.toContain("sk-1234567890abcdefghij");
  });
});

describe("recent log diagnostics", () => {
  it("keeps serialized warning and error entries for the diagnostics view", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logger = createModuleLogger("diagnostics-test");

    logger.warn("diagnostics.unique-warning", { error: new Error("network unavailable") });

    const entry = getRecentLogEntries(50, "warn")
      .find((candidate) => candidate.event === "diagnostics.unique-warning");
    expect(entry).toMatchObject({ level: "warn", module: "diagnostics-test" });
    expect(entry?.error).toMatchObject({ message: "network unavailable" });
  });

  it("serializes circular metadata without breaking logging", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    agentLogger.info("test.circular", { circular });

    const parsed = JSON.parse(String(info.mock.calls[0][0]).slice(String(info.mock.calls[0][0]).indexOf("{")));
    expect(parsed.circular.self).toBe("[Circular]");
  });

  it("does not let a throwing console sink replace application control flow", () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("console unavailable");
    });

    expect(() => agentLogger.info("test.console-failure")).not.toThrow();
  });
});

describe("log management", () => {
  it("persists settings, reports disk usage, and clears logs without deleting settings", async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-ppt-logs-"));
    const originalSettings = getLogManagerSettings();
    process.env.AGENT_PPT_DATA_DIR = tempRoot;

    try {
      const settings = await updateLogManagerSettings({ level: "warn", fileEnabled: false });
      expect(settings).toEqual({
        level: "warn",
        fileEnabled: false,
        retentionDays: 7,
        maxFileSizeMb: 10,
      });
      expect(JSON.parse(await fs.promises.readFile(path.join(getLogDirectory(), "settings.json"), "utf8")))
        .toEqual(settings);

      await fs.promises.writeFile(path.join(getLogDirectory(), "agent.log"), "diagnostic\n", "utf8");
      expect(await getLogManagerStatus()).toMatchObject({ fileCount: 1, totalBytes: 11 });
      expect(await clearLogFiles()).toBe(1);
      await expect(fs.promises.stat(path.join(getLogDirectory(), "agent.log"))).rejects.toThrow();
      await expect(fs.promises.stat(path.join(getLogDirectory(), "settings.json"))).resolves.toBeDefined();

      const retentionSettings = await updateLogManagerSettings({
        retentionDays: 14,
        maxFileSizeMb: 25,
      });
      expect(retentionSettings).toMatchObject({
        retentionDays: 14,
        maxFileSizeMb: 25,
      });
      expect(await getLogManagerStatus()).toMatchObject({
        retentionDays: 14,
        maxFileSizeMb: 25,
      });
    } finally {
      await updateLogManagerSettings(originalSettings);
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
