import { describe, expect, it, vi } from "vitest";
import { listRemoteModelsRequestSchema } from "../src/shared/remote-models";

describe("listRemoteModelsRequestSchema", () => {
  it("requires an api key or stored credential binding", () => {
    expect(() =>
      listRemoteModelsRequestSchema.parse({
        provider: "openai",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toThrow(/API key|credential/i);
  });

  it("accepts an explicit api key", () => {
    expect(
      listRemoteModelsRequestSchema.parse({
        provider: "openai",
        baseURL: "https://api.openai.com/v1/",
        apiKey: "sk-test",
      }),
    ).toMatchObject({
      provider: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });
  });

  it("accepts a stored credential binding", () => {
    expect(
      listRemoteModelsRequestSchema.parse({
        provider: "anthropic",
        baseURL: "https://api.anthropic.com",
        credentialBinding: {
          vendorId: "anthropic",
          provider: "anthropic",
          baseURL: "https://api.anthropic.com",
        },
      }),
    ).toMatchObject({
      provider: "anthropic",
      baseURL: "https://api.anthropic.com",
      credentialBinding: {
        vendorId: "anthropic",
        provider: "anthropic",
      },
    });
  });
});

describe("listRemoteModels service", () => {
  it("lists OpenAI-compatible models through the SDK client", async () => {
    vi.resetModules();
    vi.doMock("openai", () => {
      class OpenAI {
        models = {
          list: async function* () {
            yield { id: "gpt-test-b" };
            yield { id: "gpt-test-a" };
            yield { id: "gpt-test-a" };
          },
        };
      }
      return { default: OpenAI };
    });
    vi.doMock("@anthropic-ai/sdk", () => ({ default: class Anthropic {} }));

    const { listRemoteModels } = await import("../src/main/agent/gateway/list-remote-models");
    const result = await listRemoteModels(
      {
        resolveModelCredential: vi.fn(),
      } as never,
      {
        provider: "openai",
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-test",
      },
    );

    expect(result.models).toEqual([{ id: "gpt-test-a" }, { id: "gpt-test-b" }]);
  });

  it("lists Anthropic-compatible models with display names", async () => {
    vi.resetModules();
    vi.doMock("openai", () => ({ default: class OpenAI {} }));
    vi.doMock("@anthropic-ai/sdk", () => {
      class Anthropic {
        models = {
          list: async function* () {
            yield { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" };
            yield { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" };
          },
        };
      }
      return { default: Anthropic };
    });

    const { listRemoteModels } = await import("../src/main/agent/gateway/list-remote-models");
    const result = await listRemoteModels(
      {
        resolveModelCredential: vi.fn(),
      } as never,
      {
        provider: "anthropic",
        baseURL: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
      },
    );

    expect(result.models).toEqual([
      { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
    ]);
  });
});
