export interface ProviderTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface TokenUsageModel extends Required<ProviderTokenUsage> {
  provider: string;
  model: string;
  requestCount: number;
}

export type TokenTaskOutcome = "completed" | "failed" | "interrupted";

export interface TokenUsageDay {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  requestCount: number;
  taskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  interruptedTaskCount: number;
  totalTaskDurationMs: number;
  durationSampleCount: number;
  longestTaskDurationMs: number;
  models: TokenUsageModel[];
}

export interface TokenUsageStats {
  totalTokens: number;
  peakTokens: number;
  requestCount: number;
  taskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  interruptedTaskCount: number;
  averageTaskDurationMs: number;
  longestTaskDurationMs: number;
  currentStreakDays: number;
  longestStreakDays: number;
  firstRecordedAt?: string;
  lastRecordedAt?: string;
  models: TokenUsageModel[];
  days: TokenUsageDay[];
}
