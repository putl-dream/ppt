import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ProviderTokenUsage, TokenUsageDay, TokenUsageStats } from "@shared/token-usage";
import { writeJsonFileAtomic, writeTextFileAtomic } from "./agent/persistence/atomic-json-file";

const tokenUsageDaySchema = z.object({
  date: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  cacheCreationInputTokens: z.number().int().nonnegative().default(0),
  requestCount: z.number().int().nonnegative().default(0),
  taskCount: z.number().int().nonnegative().default(0),
  longestTaskDurationMs: z.number().int().nonnegative().default(0),
});

const tokenUsageFileSchema = z.object({
  version: z.literal(1),
  firstRecordedAt: z.string().optional(),
  lastRecordedAt: z.string().optional(),
  days: z.array(tokenUsageDaySchema),
});

type TokenUsageFile = z.infer<typeof tokenUsageFileSchema>;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyDistance(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay))
      / 86_400_000,
  );
}

function emptyDay(date: string): TokenUsageDay {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    requestCount: 0,
    taskCount: 0,
    longestTaskDurationMs: 0,
  };
}

function computeStreaks(activeDateKeys: string[], todayKey: string): {
  currentStreakDays: number;
  longestStreakDays: number;
} {
  if (activeDateKeys.length === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0 };
  }

  let longestStreakDays = 1;
  let running = 1;
  for (let index = 1; index < activeDateKeys.length; index += 1) {
    if (dateKeyDistance(activeDateKeys[index - 1], activeDateKeys[index]) === 1) {
      running += 1;
      longestStreakDays = Math.max(longestStreakDays, running);
    } else {
      running = 1;
    }
  }

  const latest = activeDateKeys[activeDateKeys.length - 1];
  const latestDistance = dateKeyDistance(latest, todayKey);
  if (latestDistance < 0 || latestDistance > 1) {
    return { currentStreakDays: 0, longestStreakDays };
  }

  let currentStreakDays = 1;
  for (let index = activeDateKeys.length - 1; index > 0; index -= 1) {
    if (dateKeyDistance(activeDateKeys[index - 1], activeDateKeys[index]) !== 1) break;
    currentStreakDays += 1;
  }
  return { currentStreakDays, longestStreakDays };
}

export interface ModelUsageRecord extends ProviderTokenUsage {
  provider: string;
  model: string;
  recordedAt?: Date;
}

export class TokenUsageStore {
  private data: TokenUsageFile = { version: 1, days: [] };
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      this.data = tokenUsageFileSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError) && !(error instanceof z.ZodError)) {
        throw error;
      }
      if (code !== "ENOENT") {
        try {
          this.data = tokenUsageFileSchema.parse(
            JSON.parse(await readFile(`${this.filePath}.bak`, "utf8")),
          );
          await writeTextFileAtomic(
            this.filePath,
            `${JSON.stringify(this.data, null, 2)}\n`,
          );
          return;
        } catch {
          // Both copies are unusable. Start a fresh statistics file without
          // allowing optional telemetry to block the application startup.
        }
      }
      this.data = { version: 1, days: [] };
      await writeTextFileAtomic(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
    }
  }

  async recordModelUsage(record: ModelUsageRecord): Promise<void> {
    const recordedAt = record.recordedAt ?? new Date();
    const timestamp = recordedAt.toISOString();
    await this.mutate(() => {
      const day = this.getOrCreateDay(localDateKey(recordedAt));
      day.inputTokens += record.inputTokens;
      day.outputTokens += record.outputTokens;
      day.totalTokens += record.totalTokens;
      day.cachedInputTokens += record.cachedInputTokens ?? 0;
      day.cacheCreationInputTokens += record.cacheCreationInputTokens ?? 0;
      day.requestCount += 1;
      this.data.firstRecordedAt ??= timestamp;
      this.data.lastRecordedAt = timestamp;
    });
  }

  async recordTask(durationMs: number, recordedAt = new Date()): Promise<void> {
    const safeDuration = Math.max(0, Math.round(durationMs));
    await this.mutate(() => {
      const day = this.getOrCreateDay(localDateKey(recordedAt));
      day.taskCount += 1;
      day.longestTaskDurationMs = Math.max(day.longestTaskDurationMs, safeDuration);
    });
  }

  getStats(now = new Date()): TokenUsageStats {
    const sortedDays = [...this.data.days].sort((a, b) => a.date.localeCompare(b.date));
    const activeDateKeys = sortedDays.filter((day) => day.totalTokens > 0).map((day) => day.date);
    const streaks = computeStreaks(activeDateKeys, localDateKey(now));
    return {
      totalTokens: sortedDays.reduce((sum, day) => sum + day.totalTokens, 0),
      peakTokens: sortedDays.reduce((peak, day) => Math.max(peak, day.totalTokens), 0),
      longestTaskDurationMs: sortedDays.reduce(
        (peak, day) => Math.max(peak, day.longestTaskDurationMs),
        0,
      ),
      ...streaks,
      firstRecordedAt: this.data.firstRecordedAt,
      lastRecordedAt: this.data.lastRecordedAt,
      days: sortedDays.map((day) => ({ ...day })),
    };
  }

  private getOrCreateDay(date: string): TokenUsageDay {
    let day = this.data.days.find((entry) => entry.date === date);
    if (!day) {
      day = emptyDay(date);
      this.data.days.push(day);
    }
    return day;
  }

  private async mutate(change: () => void): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      change();
      await this.persist();
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private async persist(): Promise<void> {
    await writeJsonFileAtomic(this.filePath, this.data);
  }
}

export { computeStreaks, localDateKey };
