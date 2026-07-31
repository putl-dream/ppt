// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_STORAGE_KEY,
  MODEL_VENDOR_MODELS,
  MODEL_VENDOR_PRESETS,
  buildModelVendorDraft,
  changeModelVendorDraftProtocol,
  loadManagedModels,
  materializeModelVendorDraft,
  normalizeModelTokenPricing,
  toAgentModelSettings,
} from "../src/renderer/src/modelCatalog";

describe("model catalog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defines the official vendor presets and DeepSeek Anthropic defaults", () => {
    expect(MODEL_VENDOR_PRESETS.map((preset) => preset.id)).toEqual([
      "openai",
      "anthropic",
      "deepseek",
    ]);

    const deepseek = MODEL_VENDOR_PRESETS.find((preset) => preset.id === "deepseek");
    const flash = deepseek?.models.find((model) => model.id === "deepseek-v4-flash");
    const pro = deepseek?.models.find((model) => model.id === "deepseek-v4-pro");

    expect(deepseek).toMatchObject({
      defaultProvider: "anthropic",
      defaultModelId: "deepseek-v4-flash",
      baseURLs: {
        anthropic: "https://api.deepseek.com/anthropic",
        openai: "https://api.deepseek.com",
      },
    });
    expect(flash).toMatchObject({
      provider: "anthropic",
      model: "deepseek-v4-flash",
      openaiApiMode: "responses",
      supports1MContext: true,
    });
    expect(pro).toMatchObject({
      provider: "anthropic",
      model: "deepseek-v4-pro",
      openaiApiMode: "chat-completions",
      supports1MContext: true,
    });
    expect(flash?.pricing).toEqual(expect.objectContaining({
      currency: "CNY",
      inputPerMillion: 1,
      cachedInputPerMillion: 0.02,
      outputPerMillion: 2,
    }));
    expect(pro?.pricing).toEqual(expect.objectContaining({
      currency: "CNY",
      inputPerMillion: 3,
      cachedInputPerMillion: 0.025,
      outputPerMillion: 6,
    }));
    expect(toAgentModelSettings(flash!)).toMatchObject({ supports1MContext: true });
    expect(toAgentModelSettings(flash!)).toMatchObject({
      configurationId: "deepseek-v4-flash",
    });
  });

  it("switches DeepSeek to its OpenAI URL and model-specific API modes", () => {
    const draft = buildModelVendorDraft("deepseek", []);

    const switched = changeModelVendorDraftProtocol(draft, "openai");

    expect(switched.protocol).toBe("openai");
    expect(switched.baseURL).toBe("https://api.deepseek.com");
    expect(switched.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "deepseek-v4-flash", openaiApiMode: "responses" }),
      expect.objectContaining({ id: "deepseek-v4-pro", openaiApiMode: "chat-completions" }),
    ]));
  });

  it("reuses existing vendor settings and materializes every preset model with one key", () => {
    const existing = MODEL_VENDOR_MODELS
      .filter((model) => model.id.startsWith("deepseek-"))
      .map((model) => ({
        ...model,
        provider: "openai" as const,
        baseURL: "https://proxy.example.com/v1",
        apiKey: "existing-key",
      }));
    existing[0] = { ...existing[0], name: "My Flash" };

    const draft = buildModelVendorDraft("deepseek", existing);
    const saved = materializeModelVendorDraft({ ...draft, apiKey: "new-key" });

    expect(draft).toMatchObject({
      protocol: "openai",
      baseURL: "https://proxy.example.com/v1",
      apiKey: "existing-key",
    });
    expect(draft.models[0].name).toBe("My Flash");
    expect(saved).toHaveLength(2);
    expect(saved.every((model) => model.apiKey === "new-key" && model.enabled)).toBe(true);
    expect(new Set(saved.map((model) => model.id)).size).toBe(2);
  });

  it("creates one manually configured model for a custom vendor", () => {
    const draft = buildModelVendorDraft("custom", [], "custom-test");

    expect(draft).toMatchObject({
      vendorId: "custom",
      protocol: "openai",
      models: [{ id: "custom-test", model: "" }],
    });
    expect(draft.models[0]).not.toHaveProperty("builtIn");
    expect(draft.models[0].pricing).toBeNull();
  });

  it("starts empty instead of injecting the vendor templates", () => {
    expect(loadManagedModels()).toEqual([]);
  });

  it("removes unconfigured legacy presets but preserves configured models", () => {
    const unconfigured = MODEL_VENDOR_MODELS.find((model) => model.id === "openai-gpt-5-5")!;
    const configured = {
      ...MODEL_VENDOR_MODELS.find((model) => model.id === "deepseek-v4-flash")!,
      apiKey: "configured-key",
    };
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify([
      unconfigured,
      configured,
    ]));

    const models = loadManagedModels();

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "deepseek-v4-flash",
      apiKey: "configured-key",
      builtIn: false,
    });
  });

  it("migrates legacy USD prices and preserves saved or disabled preset pricing", () => {
    expect(normalizeModelTokenPricing({
      inputPerMillionUsd: 4,
      cachedInputPerMillionUsd: 0.4,
      outputPerMillionUsd: 20,
      updatedAt: "2026-07-01",
    })).toEqual({
      currency: "USD",
      inputPerMillion: 4,
      cachedInputPerMillion: 0.4,
      outputPerMillion: 20,
      updatedAt: "2026-07-01",
    });

    const configured = MODEL_VENDOR_MODELS.find((model) => model.id === "openai-gpt-5-5")!;
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify([
      {
        ...configured,
        apiKey: "configured-key",
        pricing: {
          currency: "CNY",
          inputPerMillion: 8,
          cachedInputPerMillion: 0.8,
          outputPerMillion: 40,
          updatedAt: "2026-08-01",
        },
      },
      {
        ...MODEL_VENDOR_MODELS.find((model) => model.id === "openai-gpt-5-mini")!,
        apiKey: "configured-key",
        pricing: null,
      },
    ]));

    const models = loadManagedModels();
    expect(models.find((model) => model.id === "openai-gpt-5-5")?.pricing).toEqual(
      expect.objectContaining({ currency: "CNY", inputPerMillion: 8 }),
    );
    expect(models.find((model) => model.id === "openai-gpt-5-mini")?.pricing).toBeNull();
  });
});
