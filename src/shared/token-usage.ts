export interface ProviderTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface TokenUsageDay {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  requestCount: number;
  taskCount: number;
  longestTaskDurationMs: number;
}

export interface TokenUsageStats {
  totalTokens: number;
  peakTokens: number;
  longestTaskDurationMs: number;
  currentStreakDays: number;
  longestStreakDays: number;
  firstRecordedAt?: string;
  lastRecordedAt?: string;
  days: TokenUsageDay[];
}
