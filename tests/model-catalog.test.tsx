// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { CREDENTIAL_REENTRY_NOTICE_STORAGE_KEY } from "../src/renderer/src/credentialMigration";
import {
  buildModelVendorDraft,
  changeModelVendorDraftProtocol,
  LEGACY_MODEL_STORAGE_KEY,
  loadManagedModels,
  MODEL_STORAGE_KEY,
  MODEL_VENDOR_MODELS,
  MODEL_VENDOR_PRESETS,
  materializeModelVendorDraft,
  normalizeModelTokenPricing,
  serializeManagedModels,
  toAgentModelSelection,
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
    expect(flash?.pricing).toEqual(
      expect.objectContaining({
        currency: "CNY",
        inputPerMillion: 1,
        cachedInputPerMillion: 0.02,
        outputPerMillion: 2,
      }),
    );
    expect(pro?.pricing).toEqual(
      expect.objectContaining({
        currency: "CNY",
        inputPerMillion: 3,
        cachedInputPerMillion: 0.025,
        outputPerMillion: 6,
      }),
    );
    expect(toAgentModelSelection(flash!)).toMatchObject({ supports1MContext: true });
    expect(toAgentModelSelection(flash!)).toMatchObject({
      configurationId: "deepseek-v4-flash",
    });
    expect(toAgentModelSelection(flash!)).not.toHaveProperty("apiKey");
  });

  it("switches DeepSeek to its OpenAI URL and model-specific API modes", () => {
    const draft = buildModelVendorDraft("deepseek", []);

    const switched = changeModelVendorDraftProtocol(draft, "openai");

    expect(switched.protocol).toBe("openai");
    expect(switched.baseURL).toBe("https://api.deepseek.com");
    expect(switched.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deepseek-v4-flash", openaiApiMode: "responses" }),
        expect.objectContaining({ id: "deepseek-v4-pro", openaiApiMode: "chat-completions" }),
      ]),
    );
  });

  it("reuses existing vendor metadata without attaching the dialog key to models", () => {
    const existing = MODEL_VENDOR_MODELS.filter((model) => model.id.startsWith("deepseek-")).map(
      (model) => ({
        ...model,
        provider: "openai" as const,
        baseURL: "https://proxy.example.com/v1",
      }),
    );
    existing[0] = { ...existing[0], name: "My Flash" };

    const draft = buildModelVendorDraft("deepseek", existing);
    const saved = materializeModelVendorDraft({ ...draft, apiKey: "new-key" });

    expect(draft).toMatchObject({
      protocol: "openai",
      baseURL: "https://proxy.example.com/v1",
      apiKey: "",
    });
    expect(draft.models[0].name).toBe("My Flash");
    expect(saved).toHaveLength(2);
    expect(saved.every((model) => model.credentialConfigured && model.enabled)).toBe(true);
    expect(saved.every((model) => !("apiKey" in model))).toBe(true);
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
    window.localStorage.setItem(
      LEGACY_MODEL_STORAGE_KEY,
      JSON.stringify([unconfigured, configured]),
    );

    const models = loadManagedModels();

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "deepseek-v4-flash",
      builtIn: false,
      credentialConfigured: false,
    });
    expect(models[0]).not.toHaveProperty("apiKey");
    expect(window.localStorage.getItem(LEGACY_MODEL_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(MODEL_STORAGE_KEY)).not.toContain("configured-key");
  });

  it("allowlists persisted metadata even if a runtime object is polluted with an API key", () => {
    const configured = {
      ...MODEL_VENDOR_MODELS[0],
      credentialConfigured: true,
      apiKey: "must-not-persist",
      unexpected: "must-not-persist-either",
    };

    const serialized = serializeManagedModels([configured]);

    expect(serialized).not.toContain("must-not-persist");
    expect(JSON.parse(serialized)).toEqual([
      expect.objectContaining({ id: configured.id, model: configured.model }),
    ]);
    expect(JSON.parse(serialized)[0]).not.toHaveProperty("credentialConfigured");
    expect(JSON.parse(serialized)[0]).not.toHaveProperty("unexpected");
  });

  it("deletes malformed legacy storage and requests credential re-entry", () => {
    window.localStorage.setItem(LEGACY_MODEL_STORAGE_KEY, "{not-json");

    expect(loadManagedModels()).toEqual([]);
    expect(window.localStorage.getItem(LEGACY_MODEL_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(CREDENTIAL_REENTRY_NOTICE_STORAGE_KEY)).toBe("1");
  });

  it("migrates legacy USD prices and preserves saved or disabled preset pricing", () => {
    expect(
      normalizeModelTokenPricing({
        inputPerMillionUsd: 4,
        cachedInputPerMillionUsd: 0.4,
        outputPerMillionUsd: 20,
        updatedAt: "2026-07-01",
      }),
    ).toEqual({
      currency: "USD",
      inputPerMillion: 4,
      cachedInputPerMillion: 0.4,
      outputPerMillion: 20,
      updatedAt: "2026-07-01",
    });

    const configured = MODEL_VENDOR_MODELS.find((model) => model.id === "openai-gpt-5-5")!;
    window.localStorage.setItem(
      MODEL_STORAGE_KEY,
      JSON.stringify([
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
      ]),
    );

    const models = loadManagedModels();
    expect(models.find((model) => model.id === "openai-gpt-5-5")?.pricing).toEqual(
      expect.objectContaining({ currency: "CNY", inputPerMillion: 8 }),
    );
    expect(models.find((model) => model.id === "openai-gpt-5-mini")?.pricing).toBeNull();
  });
});
