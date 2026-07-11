import { createStream } from "rotating-file-stream";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type {
  AppLogEntry,
  AppLogLevel,
  LogManagerSettings,
  LogManagerStatus,
} from "@shared/logging";

type LogDetail = "minimal" | "full";

type AgentLogData = Record<string, unknown>;

// Lazy-initialized log file stream
let logFileStream: ReturnType<typeof createStream> | null | undefined;
let runtimeSettings: Partial<LogManagerSettings> = {};
const recentEntries: AppLogEntry[] = [];
const MAX_RECENT_ENTRIES = 300;
const RETENTION_DAYS = 7;
const MAX_FILE_SIZE_MB = 10;
const SETTINGS_FILE_NAME = "settings.json";

export function getLogDirectory(): string {
  const applicationDataRoot = process.env.AGENT_PPT_DATA_DIR
    ?? (process.env.APPDATA
      ? path.join(process.env.APPDATA, ".agent-ppt")
      : path.join(os.homedir(), ".agent-ppt"));
  return path.join(applicationDataRoot, "logs");
}

function getLogFileStream() {
  if (logFileStream !== undefined) return logFileStream;

  const shouldWriteToFile = runtimeSettings.fileEnabled ?? process.env.AGENT_LOG_FILE !== "false";
  if (!shouldWriteToFile) {
    logFileStream = null;
    return null;
  }

  const logDir = getLogDirectory();

  try {
    fs.mkdirSync(logDir, { recursive: true });

    logFileStream = createStream("agent.log", {
      interval: "1d",
      size: `${MAX_FILE_SIZE_MB}M`,
      maxFiles: RETENTION_DAYS,
      path: logDir,
      compress: "gzip",
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

const levelPriority: Record<AppLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): AppLogLevel {
  if (runtimeSettings.level) return runtimeSettings.level;
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

  if (typeof value === "string") {
    return value
      .replace(/(bearer\s+)[a-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]")
      .replace(/\b(?:sk|tvly)-[a-z0-9_-]{12,}\b/gi, "[REDACTED]");
  }

  return value;
}

function serializeValue(value: unknown, parentKey = "", seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    const details = value as Error & { code?: unknown; provider?: unknown };
    return {
      name: value.name,
      message: redactSensitiveValue("message", value.message),
      stack: redactSensitiveValue("stack", value.stack),
      code: serializeValue(details.code, "code", seen),
      provider: serializeValue(details.provider, "provider", seen),
    };
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => serializeValue(item, parentKey, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, redactSensitiveValue(key, serializeValue(entry, key, seen))]),
    );
  }
  return redactSensitiveValue(parentKey, value);
}

function write(level: AppLogLevel, event: string, data: AgentLogData = {}): void {
  if (levelPriority[level] < levelPriority[configuredLevel()]) return;

  let serializedData: AgentLogData;
  try {
    serializedData = serializeValue(data) as AgentLogData;
  } catch (error) {
    serializedData = {
      logSerializationError: error instanceof Error ? error.message : String(error),
    };
  }
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope: "agent",
    event: redactSensitiveValue("event", event) as string,
    ...serializedData,
  };
  recentEntries.push(entry);
  if (recentEntries.length > MAX_RECENT_ENTRIES) recentEntries.shift();
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

async function closeLogFileStream(): Promise<void> {
  const stream = logFileStream;
  logFileStream = undefined;
  if (!stream) return;
  await new Promise<void>((resolve) => stream.end(resolve));
}

function isLogFile(name: string): boolean {
  return name === "agent.log" || name.endsWith(".log") || name.endsWith(".log.gz");
}

export function getLogManagerSettings(): LogManagerSettings {
  return {
    level: configuredLevel(),
    fileEnabled: runtimeSettings.fileEnabled ?? process.env.AGENT_LOG_FILE !== "false",
  };
}

export async function initializeLogManager(): Promise<LogManagerSettings> {
  const settingsPath = path.join(getLogDirectory(), SETTINGS_FILE_NAME);
  runtimeSettings = {};
  try {
    const parsed = JSON.parse(await fs.promises.readFile(settingsPath, "utf8")) as Partial<LogManagerSettings>;
    runtimeSettings = {
      ...(parsed.level && parsed.level in levelPriority ? { level: parsed.level } : {}),
      ...(typeof parsed.fileEnabled === "boolean" ? { fileEnabled: parsed.fileEnabled } : {}),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") console.error("[agent] Failed to load log settings:", error);
  }
  recentEntries.length = 0;
  try {
    const activeLog = await fs.promises.readFile(path.join(getLogDirectory(), "agent.log"), "utf8");
    for (const line of activeLog.trim().split(/\r?\n/).slice(-MAX_RECENT_ENTRIES)) {
      try {
        const entry = JSON.parse(line) as AppLogEntry;
        if (
          entry
          && typeof entry.timestamp === "string"
          && typeof entry.event === "string"
          && entry.level in levelPriority
        ) {
          recentEntries.push(entry);
        }
      } catch {
        // A partially written final line should not make diagnostics unavailable.
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") console.error("[agent] Failed to load recent logs:", error);
  }
  return getLogManagerSettings();
}

export async function updateLogManagerSettings(
  patch: Partial<LogManagerSettings>,
): Promise<LogManagerSettings> {
  const previousFileEnabled = getLogManagerSettings().fileEnabled;
  if (patch.level && patch.level in levelPriority) runtimeSettings.level = patch.level;
  if (typeof patch.fileEnabled === "boolean") {
    runtimeSettings.fileEnabled = patch.fileEnabled;
  }
  if (getLogManagerSettings().fileEnabled !== previousFileEnabled) await closeLogFileStream();
  const settings = getLogManagerSettings();
  const directory = getLogDirectory();
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
  return settings;
}

export async function getLogManagerStatus(): Promise<LogManagerStatus> {
  const directory = getLogDirectory();
  const files = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
  const stats = await Promise.all(
    files
      .filter((entry) => entry.isFile() && isLogFile(entry.name))
      .map((entry) => fs.promises.stat(path.join(directory, entry.name))),
  );
  const lastWrittenMs = stats.reduce((latest, stat) => Math.max(latest, stat.mtimeMs), 0);
  return {
    ...getLogManagerSettings(),
    directory,
    retentionDays: RETENTION_DAYS,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
    fileCount: stats.length,
    totalBytes: stats.reduce((total, stat) => total + stat.size, 0),
    ...(lastWrittenMs > 0 ? { lastWrittenAt: new Date(lastWrittenMs).toISOString() } : {}),
  };
}

export function getRecentLogEntries(
  limit = 100,
  minimumLevel: AppLogLevel = "debug",
): AppLogEntry[] {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 100, MAX_RECENT_ENTRIES));
  const safeMinimumLevel = minimumLevel in levelPriority ? minimumLevel : "debug";
  return recentEntries
    .filter((entry) => levelPriority[entry.level] >= levelPriority[safeMinimumLevel])
    .slice(-safeLimit)
    .reverse()
    .map((entry) => ({ ...entry }));
}

export async function clearLogFiles(): Promise<number> {
  const directory = getLogDirectory();
  await closeLogFileStream();
  const files = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
  const targets = files.filter((entry) => entry.isFile() && isLogFile(entry.name));
  await Promise.all(targets.map((entry) => fs.promises.unlink(path.join(directory, entry.name))));
  recentEntries.length = 0;
  return targets.length;
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
