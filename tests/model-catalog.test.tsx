// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { CREDENTIAL_REENTRY_NOTICE_STORAGE_KEY } from "../src/renderer/src/credentialMigration";
import {
  buildModelVendorDraft,
  changeModelVendorDraftProtocol,
  createManagedModelsFromRemoteIds,
  flattenVendors,
  LEGACY_MODEL_STORAGE_KEY,
  LEGACY_MODEL_STORAGE_KEY_V2,
  loadManagedModels,
  loadManagedVendors,
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
      model: "deepseek-v4-flash",
      openaiApiMode: "responses",
      supports1MContext: true,
    });
    expect(pro).toMatchObject({
      model: "deepseek-v4-pro",
      openaiApiMode: "chat-completions",
      supports1MContext: true,
    });

    const flatFlash = MODEL_VENDOR_MODELS.find((model) => model.id === "deepseek-v4-flash")!;
    expect(toAgentModelSelection(flatFlash)).toMatchObject({
      supports1MContext: true,
      configurationId: "deepseek-v4-flash",
      vendorId: "deepseek",
    });
    expect(toAgentModelSelection(flatFlash)).not.toHaveProperty("apiKey");
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
    existing[0] = { ...existing[0]!, name: "My Flash" };

    const draft = buildModelVendorDraft("deepseek", existing);
    const saved = materializeModelVendorDraft({ ...draft, apiKey: "new-key" });

    expect(draft).toMatchObject({
      protocol: "openai",
      baseURL: "https://proxy.example.com/v1",
      apiKey: "",
    });
    expect(draft.models[0]!.name).toBe("My Flash");
    expect(saved).toHaveLength(2);
    expect(saved.every((model) => model.credentialConfigured && model.enabled)).toBe(true);
    expect(saved.every((model) => !("apiKey" in model))).toBe(true);
    expect(new Set(saved.map((model) => model.id)).size).toBe(2);
  });

  it("creates one manually configured model for a custom vendor", () => {
    const draft = buildModelVendorDraft("custom", [], "custom-test");

    expect(draft).toMatchObject({
      kind: "custom",
      protocol: "openai",
      models: [{ id: "custom-test", model: "" }],
    });
    expect(draft.models[0]).not.toHaveProperty("builtIn");
    expect(draft.models[0]!.pricing).toBeNull();
  });

  it("materializes selectable remote models into draft entries", () => {
    const models = createManagedModelsFromRemoteIds(
      [{ id: "gpt-5.5", displayName: "GPT-5.5" }, { id: "gpt-5-mini" }],
      {
        protocol: "openai",
        baseURL: "https://api.openai.com/v1/",
      },
      () => "custom-fixed-id",
    );

    expect(models).toEqual([
      {
        id: "custom-fixed-id",
        vendorId: "custom",
        vendorKind: "custom",
        vendorLabel: "自定义兼容服务",
        name: "GPT-5.5",
        provider: "openai",
        model: "gpt-5.5",
        baseURL: "https://api.openai.com/v1",
        openaiApiMode: "chat-completions",
        supports1MContext: false,
        enabled: true,
        pricing: null,
      },
      {
        id: "custom-fixed-id",
        vendorId: "custom",
        vendorKind: "custom",
        vendorLabel: "自定义兼容服务",
        name: "gpt-5-mini",
        provider: "openai",
        model: "gpt-5-mini",
        baseURL: "https://api.openai.com/v1",
        openaiApiMode: "chat-completions",
        supports1MContext: false,
        enabled: true,
        pricing: null,
      },
    ]);
  });

  it("starts empty instead of injecting the vendor templates", () => {
    expect(loadManagedModels()).toEqual([]);
    expect(loadManagedVendors()).toEqual([]);
  });

  it("migrates v2 flat models into vendor connections", () => {
    const configured = {
      ...MODEL_VENDOR_MODELS.find((model) => model.id === "deepseek-v4-flash")!,
      apiKey: "configured-key",
    };
    window.localStorage.setItem(LEGACY_MODEL_STORAGE_KEY_V2, JSON.stringify([configured]));

    const vendors = loadManagedVendors();
    const models = flattenVendors(vendors);

    expect(vendors).toHaveLength(1);
    expect(vendors[0]).toMatchObject({
      id: "deepseek",
      kind: "deepseek",
      protocol: "anthropic",
    });
    expect(models[0]).toMatchObject({
      id: "deepseek-v4-flash",
      vendorId: "deepseek",
      credentialConfigured: false,
    });
    expect(window.localStorage.getItem(LEGACY_MODEL_STORAGE_KEY_V2)).toBeNull();
    expect(window.localStorage.getItem(MODEL_STORAGE_KEY)).toContain('"version":3');
    expect(window.localStorage.getItem(CREDENTIAL_REENTRY_NOTICE_STORAGE_KEY)).toBe("1");
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
      vendorId: "deepseek",
      credentialConfigured: false,
    });
    expect(models[0]).not.toHaveProperty("apiKey");
    expect(window.localStorage.getItem(LEGACY_MODEL_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(MODEL_STORAGE_KEY)).not.toContain("configured-key");
  });

  it("allowlists persisted metadata even if a runtime object is polluted with an API key", () => {
    const configured = {
      ...MODEL_VENDOR_MODELS[0]!,
      credentialConfigured: true,
      apiKey: "must-not-persist",
      unexpected: "must-not-persist-either",
    };

    const serialized = serializeManagedModels([configured]);

    expect(serialized).not.toContain("must-not-persist");
    expect(JSON.parse(serialized)).toMatchObject({
      version: 3,
      vendors: [expect.objectContaining({ id: configured.vendorId })],
    });
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
      LEGACY_MODEL_STORAGE_KEY_V2,
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
