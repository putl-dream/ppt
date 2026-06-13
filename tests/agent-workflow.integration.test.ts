import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { AgentGateway } from "../src/main/agent/gateway";
import { createModelPresentationPlanner } from "../src/main/agent/planner";
import { AgentService } from "../src/main/agent/workflow";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";

let config: Record<string, string | undefined>;

function required(name: string): string {
  const value = config[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

beforeAll(async () => {
  config = parseEnv(await readFile(resolve(".env"), "utf8"));
  for (const key of ["OPENAI_BASE_URL", "OPENAI_API_MODE", "AGENT_TIMEOUT_MS", "AGENT_MAX_OUTPUT_TOKENS"] as const) {
    const value = config[key]?.trim();
    if (value) process.env[key] = value;
  }
});

describe("real model Agent workflow integration", () => {
  it(
    "plans, validates, and applies a real model response",
    async () => {
      const bus = new CommandBus(createStarterPresentation());
      const gateway = new AgentGateway();
      const selection = gateway.configure({
        provider: "openai",
        model: required("OPENAI_MODEL"),
        apiKey: required("OPENAI_API_KEY"),
      });
      const agent = new AgentService(bus, createModelPresentationPlanner(gateway));

      const result = await agent.start(
        "Set the presentation title to Workflow Integration Proof. Do not make any other changes.",
        selection,
        "AUTO",
      );

      expect(result.status).toBe("completed");
      expect(bus.getSnapshot().title).toContain("Workflow Integration Proof");
      expect(bus.getSnapshot().revision).toBeGreaterThan(0);
    },
    120_000,
  );
});
