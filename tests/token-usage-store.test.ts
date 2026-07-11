import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { TokenUsageStore } from "../src/main/token-usage-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function createStore(): Promise<{ store: TokenUsageStore; filePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "agent-ppt-token-usage-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "token-usage.json");
  const store = new TokenUsageStore(filePath);
  await store.initialize();
  return { store, filePath };
}

describe("TokenUsageStore", () => {
  it("persists provider-reported usage and derives peak and streak statistics", async () => {
    const { store, filePath } = await createStore();
    await store.recordModelUsage({
      provider: "openai",
      model: "model-a",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      recordedAt: new Date(2026, 6, 8, 12),
    });
    await store.recordModelUsage({
      provider: "anthropic",
      model: "model-b",
      inputTokens: 200,
      outputTokens: 70,
      cachedInputTokens: 30,
      totalTokens: 300,
      recordedAt: new Date(2026, 6, 9, 12),
    });
    await store.recordModelUsage({
      provider: "openai",
      model: "model-a",
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
      recordedAt: new Date(2026, 6, 10, 12),
    });
    await store.recordTask(7_200_000, new Date(2026, 6, 10, 13));

    const stats = store.getStats(new Date(2026, 6, 11, 12));
    expect(stats).toMatchObject({
      totalTokens: 550,
      peakTokens: 300,
      longestTaskDurationMs: 7_200_000,
      currentStreakDays: 3,
      longestStreakDays: 3,
    });
    expect(stats.days).toHaveLength(3);
    expect(stats.days[1]).toMatchObject({
      totalTokens: 300,
      cachedInputTokens: 30,
      requestCount: 1,
    });

    const reloaded = new TokenUsageStore(filePath);
    await reloaded.initialize();
    expect(reloaded.getStats(new Date(2026, 6, 11, 12)).totalTokens).toBe(550);
  });

  it("returns a zero current streak when the latest activity is older than yesterday", async () => {
    const { store } = await createStore();
    await store.recordModelUsage({
      provider: "openai",
      model: "model-a",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      recordedAt: new Date(2026, 5, 1, 12),
    });

    expect(store.getStats(new Date(2026, 5, 4, 12))).toMatchObject({
      currentStreakDays: 0,
      longestStreakDays: 1,
    });
  });
});
