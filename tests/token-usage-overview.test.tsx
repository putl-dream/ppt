// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenUsageOverview } from "../src/renderer/src/components/TokenUsageOverview";
import type { ManagedModel } from "../src/renderer/src/modelCatalog";

const models: ManagedModel[] = [
  {
    id: "cny-model",
    name: "CNY Model",
    provider: "openai",
    model: "same-model",
    apiKey: "key",
    baseURL: "https://cn.example.com/v1",
    openaiApiMode: "responses",
    pricing: {
      currency: "CNY",
      inputPerMillion: 1,
      cachedInputPerMillion: 0.1,
      outputPerMillion: 2,
      updatedAt: "2026-08-01",
    },
  },
  {
    id: "usd-model",
    name: "USD Model",
    provider: "openai",
    model: "same-model",
    apiKey: "key",
    baseURL: "https://us.example.com/v1",
    openaiApiMode: "responses",
    pricing: {
      currency: "USD",
      inputPerMillion: 5,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 10,
      updatedAt: "2026-08-01",
    },
  },
];

const usageModels = models.map((model) => ({
  configurationId: model.id,
  provider: model.provider,
  model: model.model,
  inputTokens: 1_000_000,
  outputTokens: 0,
  totalTokens: 1_000_000,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  requestCount: 1,
}));

describe("TokenUsageOverview pricing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("summarizes currencies separately and offers a currency switch for cost trends", async () => {
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        getTokenUsageStats: vi.fn().mockResolvedValue({
          totalTokens: 2_000_000,
          peakTokens: 2_000_000,
          requestCount: 2,
          taskCount: 0,
          completedTaskCount: 0,
          failedTaskCount: 0,
          interruptedTaskCount: 0,
          averageTaskDurationMs: 0,
          longestTaskDurationMs: 0,
          currentStreakDays: 0,
          longestStreakDays: 0,
          models: usageModels,
          days: [],
        }),
      },
    });

    render(<TokenUsageOverview models={models} selectedModelId="usd-model" />);

    await waitFor(() => expect(screen.getByText("¥1.00 · $5.00")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "预估费用" }));
    expect(screen.getByRole("tab", { name: "人民币" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "美元" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("覆盖 100% Token")).toBeTruthy();
  });
});
