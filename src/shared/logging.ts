export type AppLogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogEntry {
  timestamp: string;
  level: AppLogLevel;
  scope: string;
  event: string;
  module?: string;
  [key: string]: unknown;
}

export interface LogManagerSettings {
  level: AppLogLevel;
  fileEnabled: boolean;
  retentionDays: number;
}

export interface LogManagerStatus extends LogManagerSettings {
  directory: string;
  fileCount: number;
  totalBytes: number;
  lastWrittenAt?: string;
}

export interface RendererLogReport {
  level: AppLogLevel;
  event: string;
  data?: Record<string, unknown>;
}
