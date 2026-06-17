import { createStream } from "rotating-file-stream";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

type AgentLogLevel = "debug" | "info" | "warn" | "error";

type LogDetail = "minimal" | "full";

type AgentLogData = Record<string, unknown>;

// Lazy-initialized log file stream
let logFileStream: ReturnType<typeof createStream> | null = null;

function getLogFileStream() {
  if (logFileStream !== null) return logFileStream;

  const shouldWriteToFile = process.env.AGENT_LOG_FILE !== "false";
  if (!shouldWriteToFile) {
    logFileStream = null;
    return null;
  }

  const logDir = path.join(os.homedir(), ".agent-ppt", "logs");

  try {
    fs.mkdirSync(logDir, { recursive: true });

    logFileStream = createStream("agent.log", {
      interval: "1d",        // Rotate daily
      maxFiles: 7,           // Keep 7 days
      path: logDir,
      compress: "gzip",      // Compress old logs
    });

    logFileStream.on("error", (error) => {
      console.error("[agent] Failed to write to log file:", error);
    });

    return logFileStream;
  } catch (error) {
    console.error("[agent] Failed to initialize log file stream:", error);
    logFileStream = null;
    return null;
  }
}

type AgentLogLevel = "debug" | "info" | "warn" | "error";

type LogDetail = "minimal" | "full";

type AgentLogData = Record<string, unknown>;

const levelPriority: Record<AgentLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): AgentLogLevel {
  const value = process.env.AGENT_LOG_LEVEL?.trim().toLowerCase();
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

function configuredDetail(): LogDetail {
  const value = process.env.AGENT_LOG_DETAIL?.trim().toLowerCase();
  return value === "full" ? "full" : "minimal";
}

function redactSensitiveValue(key: string, value: unknown): unknown {
  const sensitiveKeys = [
    "apiKey",
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "token",
    "bearer",
  ];

  if (typeof value === "string" && sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
    return value.length > 8 ? `${value.slice(0, 4)}...${value.slice(-4)}` : "***";
  }

  return value;
}

function serializeValue(value: unknown, parentKey = ""): unknown {
  if (value instanceof Error) {
    const details = value as Error & { code?: unknown; provider?: unknown };
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: details.code,
      provider: details.provider,
    };
  }
  if (Array.isArray(value)) return value.map((item) => serializeValue(item, parentKey));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, redactSensitiveValue(key, serializeValue(entry, key))]),
    );
  }
  return redactSensitiveValue(parentKey, value);
}

function write(level: AgentLogLevel, event: string, data: AgentLogData = {}): void {
  if (levelPriority[level] < levelPriority[configuredLevel()]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope: "agent",
    event,
    ...(serializeValue(data) as AgentLogData),
  };
  // Keep console output ASCII-only so Windows terminals using a legacy code page
  // cannot reinterpret UTF-8 log bytes as mojibake. JSON parsers restore the
  // original Unicode text from these escape sequences.
  const json = JSON.stringify(entry).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const line = `[agent] ${json}`;

  // Console output (with Unicode escaping for terminal compatibility)
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "debug") {
    console.debug(line);
  } else {
    console.info(line);
  }

  // File output (with original Unicode, no escaping needed)
  const fileStream = getLogFileStream();
  if (fileStream) {
    const fileJson = JSON.stringify(entry);
    fileStream.write(fileJson + "\n");
  }
}

export const agentLogger = {
  debug: (event: string, data?: AgentLogData) => write("debug", event, data),
  info: (event: string, data?: AgentLogData) => write("info", event, data),
  warn: (event: string, data?: AgentLogData) => write("warn", event, data),
  error: (event: string, data?: AgentLogData) => write("error", event, data),
};

export function createModuleLogger(module: string) {
  return {
    debug: (event: string, data?: AgentLogData) => write("debug", event, { ...data, module }),
    info: (event: string, data?: AgentLogData) => write("info", event, { ...data, module }),
    warn: (event: string, data?: AgentLogData) => write("warn", event, { ...data, module }),
    error: (event: string, data?: AgentLogData) => write("error", event, { ...data, module }),
  };
}

export function requestSummary(
  request: string,
  forceDetail?: LogDetail,
): { requestLength: number; requestPreview: string; requestFull?: string } {
  const detail = forceDetail ?? configuredDetail();
  const normalized = request.replace(/\s+/g, " ").trim();
  const preview = normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;

  return {
    requestLength: request.length,
    requestPreview: preview,
    ...(detail === "full" && { requestFull: request }),
  };
}
