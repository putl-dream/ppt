import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentGateway } from "../src/main/agent/gateway";
import { textFromContentBlocks } from "../src/main/agent/gateway/content-blocks";

const ENV_KEYS = [
  "OPENAI_BASE_URL",
  "OPENAI_API_MODE",
  "ANTHROPIC_BASE_URL",
  "AGENT_TIMEOUT_MS",
  "AGENT_MAX_OUTPUT_TOKENS",
] as const;

const previousEnvironment: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let config: Record<string, string | undefined>;

function required(name: string): string {
  const value = config[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env.example`);
  return value;
}

beforeAll(async () => {
  config = parseEnv(await readFile(resolve(".env.example"), "utf8"));

  for (const key of ENV_KEYS) {
    previousEnvironment[key] = process.env[key];
    const value = config[key]?.trim();
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe.sequential("AgentGateway real provider integration", () => {
  it(
    "generates text through the configured OpenAI-compatible endpoint",
    async () => {
      const gateway = new AgentGateway();
      const selection = gateway.configure({
        provider: "openai",
        model: required("OPENAI_MODEL"),
        apiKey: required("OPENAI_API_KEY"),
      });

      const response = await gateway.generateText(
        {
          systemPrompt: "You are a connectivity test. Reply with one short sentence only.",
          prompt: "Confirm that the OpenAI-compatible gateway request succeeded.",
        },
        selection,
      );

      expect(response.provider).toBe("openai");
      expect(response.model).toBe(required("OPENAI_MODEL"));
      expect(textFromContentBlocks(response.content).length).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "generates text through the configured Anthropic-compatible endpoint",
    async () => {
      const gateway = new AgentGateway();
      const selection = gateway.configure({
        provider: "anthropic",
        model: required("ANTHROPIC_MODEL"),
        apiKey: required("ANTHROPIC_API_KEY"),
      });

      const response = await gateway.generateText(
        {
          systemPrompt: "You are a connectivity test. Reply with one short sentence only.",
          prompt: "Confirm that the Anthropic-compatible gateway request succeeded.",
        },
        selection,
      );

      expect(response.provider).toBe("anthropic");
      expect(response.model).toBe(required("ANTHROPIC_MODEL"));
      expect(textFromContentBlocks(response.content).length).toBeGreaterThan(0);
    },
    120_000,
  );
});
