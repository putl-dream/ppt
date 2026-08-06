// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_GATEWAY_CONFIG_STORAGE_KEY,
  LEGACY_AGENT_GATEWAY_CONFIG_STORAGE_KEY,
} from "../src/renderer/src/agentGatewayConfig";
import { loadAppBootstrapSnapshot } from "../src/renderer/src/app/appBootstrap";
import {
  LEGACY_MODEL_STORAGE_KEY,
  MODEL_STORAGE_KEY,
  MODEL_VENDOR_MODELS,
} from "../src/renderer/src/modelCatalog";

describe("app bootstrap credential migration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not import a legacy key and consumes the re-entry notice once", () => {
    window.localStorage.setItem(
      LEGACY_MODEL_STORAGE_KEY,
      JSON.stringify([
        {
          ...MODEL_VENDOR_MODELS[0],
          apiKey: "legacy-secret",
        },
      ]),
    );

    const first = loadAppBootstrapSnapshot();
    const second = loadAppBootstrapSnapshot();

    expect(first.credentialReentryRequired).toBe(true);
    expect(second.credentialReentryRequired).toBe(false);
    expect(first.models[0]).not.toHaveProperty("apiKey");
    expect(window.localStorage.getItem(MODEL_STORAGE_KEY)).not.toContain("legacy-secret");
  });

  it("keeps v2 metadata while auditing and deleting coexisting v1 secrets", () => {
    window.localStorage.setItem(
      MODEL_STORAGE_KEY,
      JSON.stringify([
        {
          ...MODEL_VENDOR_MODELS[0],
          name: "V2 Model",
        },
      ]),
    );
    window.localStorage.setItem(
      LEGACY_MODEL_STORAGE_KEY,
      JSON.stringify([
        {
          ...MODEL_VENDOR_MODELS[1],
          name: "Legacy Model",
          apiKey: "legacy-model-secret",
        },
      ]),
    );
    window.localStorage.setItem(
      AGENT_GATEWAY_CONFIG_STORAGE_KEY,
      JSON.stringify({
        timeoutMs: 240_000,
        maxOutputTokens: 12_000,
        webSearchEndpoint: "https://v2-search.example.com",
      }),
    );
    window.localStorage.setItem(
      LEGACY_AGENT_GATEWAY_CONFIG_STORAGE_KEY,
      JSON.stringify({
        timeoutMs: 360_000,
        maxOutputTokens: 8_000,
        webSearchApiKey: "legacy-search-secret",
        webSearchEndpoint: "https://legacy-search.example.com",
      }),
    );

    const snapshot = loadAppBootstrapSnapshot();

    expect(snapshot.models).toHaveLength(1);
    expect(snapshot.models[0].name).toBe("V2 Model");
    expect(snapshot.agentGatewayPreferences).toMatchObject({
      timeoutMs: 240_000,
      maxOutputTokens: 12_000,
      webSearchEndpoint: "https://v2-search.example.com",
    });
    expect(snapshot.credentialReentryRequired).toBe(true);
    expect(window.localStorage.getItem(LEGACY_MODEL_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_AGENT_GATEWAY_CONFIG_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(MODEL_STORAGE_KEY)).not.toContain("legacy-model-secret");
    expect(window.localStorage.getItem(AGENT_GATEWAY_CONFIG_STORAGE_KEY)).not.toContain(
      "legacy-search-secret",
    );
  });
});
