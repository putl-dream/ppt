type AgentLogLevel = "debug" | "info" | "warn" | "error";

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

function serializeValue(value: unknown): unknown {
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
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, serializeValue(entry)]),
    );
  }
  return value;
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
  const line = `[agent] ${JSON.stringify(entry)}`;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else if (level === "debug") {
    console.debug(line);
  } else {
    console.info(line);
  }
}

export const agentLogger = {
  debug: (event: string, data?: AgentLogData) => write("debug", event, data),
  info: (event: string, data?: AgentLogData) => write("info", event, data),
  warn: (event: string, data?: AgentLogData) => write("warn", event, data),
  error: (event: string, data?: AgentLogData) => write("error", event, data),
};

export function requestSummary(request: string): { requestLength: number; requestPreview: string } {
  const normalized = request.replace(/\s+/g, " ").trim();
  return {
    requestLength: request.length,
    requestPreview: normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized,
  };
}
