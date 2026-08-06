import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getCredentialStatusWithEnvironment,
  hydrateAgentModelSettings,
  hydrateAgentRunServices,
} from "../src/main/credential-runtime";
import { CredentialStore, type SafeStorageAdapter } from "../src/main/credential-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("credential runtime hydration", () => {
  it("hydrates primary, fallback, and search credentials only inside Main", async () => {
    const store = await createStore();
    const primary = {
      configurationId: "primary",
      provider: "openai" as const,
      model: "gpt-5.5",
      baseURL: "https://api.example.test/v1",
      openaiApiMode: "responses" as const,
    };
    const fallback = {
      configurationId: "fallback",
      provider: "anthropic" as const,
      model: "claude-sonnet-4-6",
      baseURL: "https://anthropic.example.test",
    };
    await store.setModelCredentials({
      bindings: [
        {
          configurationId: primary.configurationId,
          provider: primary.provider,
          model: primary.model,
          baseURL: primary.baseURL,
          apiMode: primary.openaiApiMode,
        },
      ],
      apiKey: "primary-secret",
    });
    await store.setModelCredentials({
      bindings: [
        {
          configurationId: fallback.configurationId,
          provider: fallback.provider,
          model: fallback.model,
          baseURL: fallback.baseURL,
        },
      ],
      apiKey: "fallback-secret",
    });
    await store.setWebSearchCredential({
      binding: { endpoint: "https://api.tavily.com/search" },
      apiKey: "search-secret",
    });

    await expect(hydrateAgentModelSettings(store, primary)).resolves.toEqual({
      ...primary,
      apiKey: "primary-secret",
    });
    await expect(
      hydrateAgentRunServices(store, {
        timeoutMs: 180_000,
        maxOutputTokens: 16_384,
        fallbackModel: fallback,
        webSearchTimeoutMs: 20_000,
      }),
    ).resolves.toEqual({
      gateway: {
        timeoutMs: 180_000,
        maxOutputTokens: 16_384,
        fallbackModel: { ...fallback, apiKey: "fallback-secret" },
      },
      search: {
        webSearchApiKey: "search-secret",
        webSearchEndpoint: "https://api.tavily.com/search",
        webSearchTimeoutMs: 20_000,
      },
    });
  });

  it("does not reuse a stored key after the model binding changes", async () => {
    const store = await createStore();
    await store.setModelCredentials({
      bindings: [
        {
          configurationId: "primary",
          provider: "openai",
          model: "gpt-5.5",
          baseURL: "https://safe.example.test/v1",
          apiMode: "responses",
        },
      ],
      apiKey: "bound-secret",
    });

    await expect(
      hydrateAgentModelSettings(store, {
        configurationId: "primary",
        provider: "openai",
        model: "gpt-5.5",
        baseURL: "https://attacker.example.test/v1",
        openaiApiMode: "responses",
      }),
    ).resolves.not.toHaveProperty("apiKey");
  });

  it("leaves selections without a configuration ID to environment credentials", async () => {
    const store = await createStore();

    await expect(
      hydrateAgentModelSettings(store, {
        provider: "openai",
        model: "environment-model",
      }),
    ).resolves.toEqual({
      provider: "openai",
      model: "environment-model",
    });
    await expect(
      hydrateAgentRunServices(store, {
        timeoutMs: 180_000,
        maxOutputTokens: 16_384,
        fallbackModel: {
          provider: "anthropic",
          model: "environment-fallback",
        },
      }),
    ).resolves.toMatchObject({
      gateway: {
        fallbackModel: {
          provider: "anthropic",
          model: "environment-fallback",
        },
      },
    });
  });

  it("reports environment fallbacks without exposing their values", async () => {
    const store = await createStore();
    const status = await getCredentialStatusWithEnvironment(
      store,
      {
        models: [
          {
            configurationId: "openai-env",
            provider: "openai",
            model: "gpt-5.5",
          },
        ],
        webSearch: { endpoint: "https://api.tavily.com/search" },
      },
      {
        OPENAI_API_KEY: "environment-model-secret",
        TAVILY_API_KEY: "environment-search-secret",
      },
    );

    expect(status.models).toEqual([{ configurationId: "openai-env", configured: true }]);
    expect(status.webSearchConfigured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("environment-");
  });

  it("reports environment credentials only for their bound routes", async () => {
    const store = await createStore();
    const environment = {
      OPENAI_API_KEY: "openai-environment-key",
      OPENAI_BASE_URL: "https://openai-proxy.example.test/v1",
      ANTHROPIC_API_KEY: "anthropic-environment-key",
      ANTHROPIC_BASE_URL: "https://anthropic-proxy.example.test/v1",
      TAVILY_API_KEY: "tavily-environment-key",
      TAVILY_SEARCH_ENDPOINT: "https://tavily-proxy.example.test/search",
    };
    const status = await getCredentialStatusWithEnvironment(
      store,
      {
        models: [
          {
            configurationId: "openai-attacker",
            provider: "openai",
            model: "gpt-5.5",
            baseURL: "https://attacker.example.test/v1",
          },
          {
            configurationId: "openai-official",
            provider: "openai",
            model: "gpt-5.5",
            baseURL: "https://api.openai.com/v1/",
          },
          {
            configurationId: "anthropic-bound",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            baseURL: "https://anthropic-proxy.example.test/v1/",
          },
          {
            configurationId: "anthropic-attacker",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            baseURL: "https://attacker.example.test/v1",
          },
        ],
        webSearch: { endpoint: "https://attacker.example.test/search" },
      },
      environment,
    );

    expect(status.models).toEqual([
      { configurationId: "openai-attacker", configured: false },
      { configurationId: "openai-official", configured: true },
      { configurationId: "anthropic-bound", configured: true },
      { configurationId: "anthropic-attacker", configured: false },
    ]);
    expect(status.webSearchConfigured).toBe(false);

    await expect(
      getCredentialStatusWithEnvironment(
        store,
        {
          models: [],
          webSearch: { endpoint: "https://tavily-proxy.example.test/search/" },
        },
        environment,
      ),
    ).resolves.toMatchObject({ webSearchConfigured: true });
    await expect(
      getCredentialStatusWithEnvironment(
        store,
        {
          models: [],
        },
        {
          TAVILY_API_KEY: "default-environment-key",
        },
      ),
    ).resolves.toMatchObject({ webSearchConfigured: true });
  });
});

async function createStore(): Promise<CredentialStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-ppt-runtime-credentials-"));
  temporaryDirectories.push(directory);
  return new CredentialStore({
    applicationDataRoot: directory,
    safeStorage: new FakeSafeStorage(),
  });
}

class FakeSafeStorage implements SafeStorageAdapter {
  decryptString(encrypted: Buffer): string {
    return encrypted.toString("utf8").slice(4);
  }

  async decryptStringAsync(encrypted: Buffer): Promise<{
    result: string;
    shouldReEncrypt: boolean;
  }> {
    return { result: this.decryptString(encrypted), shouldReEncrypt: false };
  }

  encryptString(plainText: string): Buffer {
    return Buffer.from(`enc:${plainText}`, "utf8");
  }

  async encryptStringAsync(plainText: string): Promise<Buffer> {
    return this.encryptString(plainText);
  }

  getSelectedStorageBackend(): "unknown" {
    return "unknown";
  }

  async isAsyncEncryptionAvailable(): Promise<boolean> {
    return true;
  }

  isEncryptionAvailable(): boolean {
    return true;
  }
}
